// src/lib/compliance.ts
import {
    addDoc, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot,
    orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where
  } from "firebase/firestore";
  import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
  import { db } from "@/firebase";

  export type DocStatus = "pending" | "submitted" | "verified" | "rejected" | "expired";
  export type DocType = "compliance" | "agreement";

  export interface UploadedBy {
    uid: string;
    email?: string;
    role?: string;         // "ops" | "incubatee" | "director" | etc.
    name?: string;
  }

  export interface RequiredDocTemplate {
    id: string;            // templateId (e.g., "BEE_CERT")
    title: string;
    type: DocType;
    departmentOwner: string;
    mandatory: boolean;
    expiryRule?: { months?: number; years?: number } | null; // optional auto-expiry
  }

  export interface AppDocInstance {
    id: string;                   // docIdInstance
    templateId: string;
    title: string;
    type: DocType;
    departmentOwner: string;
    mandatory: boolean;
    status: DocStatus;
    latestFile?: {
      storagePath: string;
      url: string;
      size?: number;
      contentType?: string;
      uploadedAt: any;
      uploadedBy: UploadedBy;
    };
    expiryDate?: any | null;
    notes?: string;
    history?: Array<{ at: any; by: UploadedBy; action: string; meta?: any }>;
    participantId?: string;
    programId: string;

  }

  const PARTICIPANTS_COLLECTION = "participants"; // if yours is "perticipants", update here once.
  const APPLICATIONS = "applications";
  const PROGRAMS = "programs";

  function appDocsCol(applicationId: string) {
    return collection(db, APPLICATIONS, applicationId, "documents");
  }
  function appDocRef(applicationId: string, docIdInstance: string) {
    return doc(db, APPLICATIONS, applicationId, "documents", docIdInstance);
  }
  function versionsCol(applicationId: string, docIdInstance: string) {
    return collection(db, APPLICATIONS, applicationId, "documents", docIdInstance, "versions");
  }
  function programTemplatesCol(programId: string) {
    return collection(db, PROGRAMS, programId, "requiredDocs");
  }
  function deptMappingRef(programId: string, departmentId: string) {
    return doc(db, PROGRAMS, programId, "deptMappings", departmentId);
  }

  /** 1) Instantiate required docs for an application from program templates */
  export async function ensureAppDocInstancesForProgram(params: {
    applicationId: string;
    programId: string;
    participantId?: string;
  }) {
    const { applicationId, programId, participantId } = params;
    const tmplSnap = await getDocs(programTemplatesCol(programId));
    const existing = await getDocs(appDocsCol(applicationId));
    const existingTemplateIds = new Set(existing.docs.map(d => (d.data() as any).templateId));

    const batch: Promise<any>[] = [];
    tmplSnap.forEach(t => {
      const td = t.data() as any as RequiredDocTemplate;
      if (!existingTemplateIds.has(td.id)) {
        const init: Omit<AppDocInstance, "id"> = {
          templateId: td.id,
          title: td.title,
          type: td.type,
          departmentOwner: td.departmentOwner,
          mandatory: td.mandatory,
          status: "pending",
          programId,
          participantId
        };
        batch.push(addDoc(appDocsCol(applicationId), init));
      }
    });
    await Promise.all(batch);
  }

  /** 2) Save/upload a document version and update the instance (works for ops or incubatee) */
  export async function saveDocumentVersion(params: {
    applicationId: string;
    docIdInstance: string;
    file: File | Blob;
    fileName: string;
    uploadedBy: UploadedBy;
    contentType?: string;
    autoStatus?: DocStatus;           // defaults to "submitted"
    computeExpiry?: boolean;          // if true, set expiry from template expiryRule
  }) {
    const {
      applicationId, docIdInstance, file, fileName, uploadedBy,
      contentType, autoStatus = "submitted", computeExpiry = true
    } = params;

    const docRef = appDocRef(applicationId, docIdInstance);
    const base = (await getDoc(docRef)).data() as AppDocInstance | undefined;
    if (!base) throw new Error("Document instance not found");

    // Upload to Storage
    const storage = getStorage();
    const storagePath = `${APPLICATIONS}/${applicationId}/documents/${docIdInstance}/${Date.now()}_${fileName}`;
    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, file, { contentType });
    const url = await getDownloadURL(fileRef);

    // Compute expiry from the template if requested
    let expiryDate: any | null | undefined = base.expiryDate ?? null;
    if (computeExpiry) {
      // load the template to read expiryRule
      const tmplRef = doc(db, PROGRAMS, base.programId, "requiredDocs", base.templateId);
      const tmplSnap = await getDoc(tmplRef);
      if (tmplSnap.exists()) {
        const tmpl = tmplSnap.data() as RequiredDocTemplate;
        if (tmpl.expiryRule) {
          const now = Timestamp.now().toDate();
          if (tmpl.expiryRule.years) now.setFullYear(now.getFullYear() + tmpl.expiryRule.years);
          if (tmpl.expiryRule.months) now.setMonth(now.getMonth() + tmpl.expiryRule.months);
          expiryDate = Timestamp.fromDate(now);
        }
      }
    }

    // Append a version record
    const v = {
      fileName,
      storagePath,
      url,
      uploadedAt: serverTimestamp(),
      uploadedBy,
      contentType,
      size: (file as any).size
    };
    await addDoc(versionsCol(applicationId, docIdInstance), v);

    // Update the instance
    await updateDoc(docRef, {
      latestFile: { ...v },
      status: autoStatus,
      expiryDate,
      history: arrayUnion({
        at: serverTimestamp(),
        by: uploadedBy,
        action: "upload_version",
        meta: { fileName }
      })
    });

    // Auto-roll summary
    await rollComplianceSummary(applicationId);
  }

  /** 3) Verify/reject a document (ops or dept owner action) */
  export async function setDocumentStatus(params: {
    applicationId: string;
    docIdInstance: string;
    status: Exclude<DocStatus, "submitted">; // verified | rejected | expired | pending
    by: UploadedBy;
    note?: string;
  }) {
    const { applicationId, docIdInstance, status, by, note } = params;
    const docRef = appDocRef(applicationId, docIdInstance);
    await updateDoc(docRef, {
      status,
      history: arrayUnion({
        at: serverTimestamp(),
        by,
        action: "status_change",
        meta: { status, note }
      }),
      ...(note ? { notes: note } : {})
    });
    await rollComplianceSummary(applicationId);
  }

  /** 4) List docs (both sides) with optional scoping by dept and type */
  export async function listDocuments(params: {
    applicationId: string;
    departmentOwner?: string;
    type?: DocType;
    statusIn?: DocStatus[];
  }) {
    const { applicationId, departmentOwner, type, statusIn } = params;
    let qRef = query(appDocsCol(applicationId));
    const filters: any[] = [];
    if (departmentOwner) filters.push(where("departmentOwner", "==", departmentOwner));
    if (type) filters.push(where("type", "==", type));
    // Firestore can't do "in" on array easily with other where in some combos; do client filter as fallback:
    if (filters.length) {
      qRef = query(appDocsCol(applicationId), ...filters);
    }
    const snap = await getDocs(qRef);
    let items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppDocInstance[];
    if (statusIn) items = items.filter(i => statusIn.includes(i.status));
    return items;
  }

  /** 5) Stream versions for a doc (nice for a side panel in both UIs) */
  export function onVersions(
    applicationId: string,
    docIdInstance: string,
    cb: (vers: any[]) => void
  ) {
    const qRef = query(versionsCol(applicationId, docIdInstance), orderBy("uploadedAt", "desc"));
    return onSnapshot(qRef, (snap) => {
      const vers = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      cb(vers);
    });
  }

  /** 6) Compute and persist compliance summary */
  export async function rollComplianceSummary(applicationId: string) {
    const snap = await getDocs(appDocsCol(applicationId));
    const docs = snap.docs.map(d => d.data() as AppDocInstance);
    const mandatory = docs.filter(d => d.mandatory);
    const verified = mandatory.filter(d => d.status === "verified");
    const score = mandatory.length ? Math.round((verified.length / mandatory.length) * 100) : 0;
    await setDoc(doc(db, APPLICATIONS, applicationId, "complianceSummary"), {
      total: docs.length,
      mandatory: mandatory.length,
      verified: verified.length,
      score,
      updatedAt: serverTimestamp()
    });
  }

  /** 7) Helper: get department’s required doc IDs for a program */
  export async function getDeptRequiredDocIds(programId: string, departmentId: string) {
    const m = await getDoc(deptMappingRef(programId, departmentId));
    if (!m.exists()) return [];
    const data = m.data() as { requiredDocIds?: string[] };
    return data.requiredDocIds || [];
  }

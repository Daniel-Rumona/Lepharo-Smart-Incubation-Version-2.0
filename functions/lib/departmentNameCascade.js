"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cascadeDepartmentName = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const syntheticData_1 = require("./syntheticData");
const firebase_1 = require("./firebase");
const firestore_2 = require("./utils/firestore");
const BATCH_SIZE = 400;
const clean = (value) => String(value ?? "").trim();
/**
 * Records keep a display copy of their department's name next to its
 * departmentId. Matching always uses the id, so a rename only has to refresh
 * those copies. Historic snapshots (audit logs, workflow query actors) keep the
 * name as it was at the time and are left alone.
 */
const COPIES = [
    { collection: "users", idField: "departmentId", nameFields: ["departmentName", "department"] },
    { collection: "operationsStaff", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "coordinators", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "movDocuments", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "consolidatedMOVs", idField: "departmentId", nameFields: ["department"] },
    { collection: "libraryMaterials", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "kpiTargets", idField: "departmentId", nameFields: ["department"] },
    { collection: "qualityObjectives", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "implementationPlans", idField: "departmentId", nameFields: ["departmentName"] },
    { collection: "events", idField: "departmentId", nameFields: ["department"] },
];
async function collectPatches(departmentId, name) {
    const patches = [];
    for (const copy of COPIES) {
        const snapshot = await firebase_1.db.collection(copy.collection).where(copy.idField, "==", departmentId).get();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const changed = {};
            for (const field of copy.nameFields) {
                // `department` sometimes holds an id or an object; only refresh name strings.
                if (typeof data[field] === "string" && data[field] !== departmentId && data[field] !== name) {
                    changed[field] = name;
                }
            }
            if (Object.keys(changed).length)
                patches.push({ ref: doc.ref, data: changed });
        }
    }
    // KPI definitions: the lead department plus the contributor name arrays,
    // which are positionally aligned with contributorDepartmentIds.
    const kpis = await firebase_1.db.collection("kpiDefinitions").where("leadDepartmentId", "==", departmentId).get();
    const contributing = await firebase_1.db.collection("kpiDefinitions")
        .where("contributorDepartmentIds", "array-contains", departmentId).get();
    const kpiDocs = new Map([...kpis.docs, ...contributing.docs].map((doc) => [doc.ref.path, doc]));
    for (const doc of kpiDocs.values()) {
        const data = doc.data();
        const changed = {};
        if (data.leadDepartmentId === departmentId) {
            if (data.leadDepartmentName !== name)
                changed.leadDepartmentName = name;
            if (typeof data.department === "string" && data.department !== name)
                changed.department = name;
        }
        const ids = Array.isArray(data.contributorDepartmentIds) ? data.contributorDepartmentIds : [];
        if (Array.isArray(data.contributorDepartmentNames) && ids.includes(departmentId)) {
            const names = ids.map((id, index) => (id === departmentId ? name : data.contributorDepartmentNames[index]));
            if (JSON.stringify(names) !== JSON.stringify(data.contributorDepartmentNames)) {
                changed.contributorDepartmentNames = names;
            }
        }
        if (Array.isArray(data.sharedContributors)) {
            const shared = data.sharedContributors.map((item) => item?.departmentId === departmentId && item.departmentName !== name ? { ...item, departmentName: name } : item);
            if (JSON.stringify(shared) !== JSON.stringify(data.sharedContributors))
                changed.sharedContributors = shared;
        }
        if (Object.keys(changed).length)
            patches.push({ ref: doc.ref, data: changed });
    }
    // Documents keyed by the department id itself.
    const exportSettings = await firebase_1.db.collection("dataExportSettings").doc(departmentId).get();
    if (exportSettings.exists && exportSettings.data()?.departmentName !== name) {
        patches.push({ ref: exportSettings.ref, data: { departmentName: name } });
    }
    const programs = await firebase_1.db.collection("programs").select().get();
    const requirementRefs = programs.docs.map((program) => program.ref.collection("deptRequirements").doc(departmentId));
    const requirements = requirementRefs.length ? await firebase_1.db.getAll(...requirementRefs) : [];
    requirements
        .filter((doc) => doc.exists && doc.data()?.departmentName !== name)
        .forEach((doc) => patches.push({ ref: doc.ref, data: { departmentName: name } }));
    return patches;
}
exports.cascadeDepartmentName = (0, firestore_1.onDocumentUpdated)({ document: "departments/{departmentId}", region: "us-central1" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const departmentId = String(event.params.departmentId);
    if ((0, syntheticData_1.isSyntheticData)(after, departmentId))
        return;
    const name = clean(after.name);
    if (!name || clean(before.name) === name)
        return;
    const patches = await collectPatches(departmentId, name);
    for (const chunk of (0, firestore_2.chunkArray)(patches, BATCH_SIZE)) {
        const batch = firebase_1.db.batch();
        chunk.forEach((patch) => batch.update(patch.ref, patch.data));
        await batch.commit();
    }
    logger.info("Cascaded department rename", {
        departmentId,
        from: clean(before.name),
        to: name,
        documents: patches.length,
    });
});
//# sourceMappingURL=departmentNameCascade.js.map
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { admin, db } from "./firebase";

const branchIdOf = (data: any): string =>
  String(data?.assignedBranch?.id || data?.branchId || "").trim();

export const syncProgramToBranchCoordinators = onDocumentWritten(
  "programs/{programId}",
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const programId = String(event.params.programId);
    const data = after.data();

    const branchId = branchIdOf(data);
    if (!branchId) return;

    const beforeBranchId = event.data?.before?.exists
      ? branchIdOf(event.data.before.data())
      : "";

    if (beforeBranchId === branchId) return;

    const coordinators = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot
    >();

    const queries = [
      db.collection("coordinators").where("branchId", "==", branchId),
      db.collection("coordinators").where("assignedBranch", "==", branchId),
      db.collection("coordinators").where(
        "branchIds",
        "array-contains",
        branchId
      ),
    ];

    for (const query of queries) {
      const snapshot = await query.get();

      snapshot.docs.forEach((doc) => {
        coordinators.set(doc.ref.path, doc);
      });
    }

    const writes: Promise<unknown>[] = [];

    for (const coordinatorDoc of coordinators.values()) {
      const coordinator = coordinatorDoc.data();

      writes.push(
        coordinatorDoc.ref.update({
          assignedPrograms:
            admin.firestore.FieldValue.arrayUnion(programId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );

      const uid = String(
        coordinator.authUid || coordinator.uid || ""
      ).trim();

      if (uid) {
        writes.push(
          db
            .collection("users")
            .doc(uid)
            .set(
              {
                assignedPrograms:
                  admin.firestore.FieldValue.arrayUnion(programId),
                updatedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            )
        );
      } else if (coordinator.email) {
        const users = await db
          .collection("users")
          .where("email", "==", coordinator.email)
          .get();

        users.docs.forEach((userDoc) => {
          writes.push(
            userDoc.ref.set(
              {
                assignedPrograms:
                  admin.firestore.FieldValue.arrayUnion(programId),
                updatedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            )
          );
        });
      }
    }

    await Promise.all(writes);

    logger.info("Extended coordinator program assignments", {
      programId,
      branchId,
      coordinators: coordinators.size,
    });
  }
);

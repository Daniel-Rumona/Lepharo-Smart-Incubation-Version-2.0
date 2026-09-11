import express, { Request, Response } from "express";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  where,
  Timestamp
} from "firebase/firestore";
import bodyParser from "body-parser";
import { db } from "@/firebase";

/**
 * GET Consultant Metrics
 * Returns average revenue, average employees, and bank statements count for all incubatees.
 */
app.get("/api/consultant/dashboard", async (req: Request, res: Response) => {
    try {
      const metrics: any[] = [];
      let totalRevenue = 0;
      let totalEmployees = 0;
      let totalBankStatements = 0;
      let incubateesCount = 0;

      const snapshot = await getDocs(collection(db, "monthlyPerformance"));

      for (const incubateeDoc of snapshot.docs) {
        const historyRef = collection(db, `monthlyPerformance/${incubateeDoc.id}/history`);
        const historySnap = await getDocs(historyRef);

        let incubateeRevenue = 0;
        let incubateeEmployees = 0;
        let incubateeBankStatements = 0;
        let monthsCount = 0;

        historySnap.forEach((doc) => {
          const data = doc.data();
          incubateeRevenue += data.revenue || 0;
          incubateeEmployees += (data.headPermanent || 0) + (data.headTemporary || 0);
          incubateeBankStatements += (data.revenueProofUrls || []).length;
          monthsCount++;
        });

        if (monthsCount > 0) {
          incubateesCount++;
          metrics.push({
            participantId: incubateeDoc.id,
            avgRevenue: incubateeRevenue / monthsCount,
            avgEmployees: incubateeEmployees / monthsCount,
            bankStatementsCount: incubateeBankStatements
          });

          totalRevenue += incubateeRevenue / monthsCount;
          totalEmployees += incubateeEmployees / monthsCount;
          totalBankStatements += incubateeBankStatements;
        }
      }

      res.status(200).json({
        totalIncubatees: incubateesCount,
        avgRevenue: incubateesCount ? totalRevenue / incubateesCount : 0,
        avgEmployees: incubateesCount ? totalEmployees / incubateesCount : 0,
        totalBankStatements,
        incubatees: metrics
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch consultant metrics" });
    }
  });

  /**
 * POST Pull Documents
 * Body: { participantId: string, startDate: string, endDate: string }
 */
app.post("/api/incubatees/pull-documents", async (req: Request, res: Response) => {
    try {
      const { participantId, startDate, endDate } = req.body;

      const historyRef = collection(db, `monthlyPerformance/${participantId}/history`);
      const historySnap = await getDocs(historyRef);

      const pulledDocuments: any[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);

      historySnap.forEach((docSnap) => {
        const data = docSnap.data();
        const docDate = new Date(data.createdAt.toDate());
        if (docDate >= start && docDate <= end) {
          pulledDocuments.push({
            month: data.month,
            bankStatements: data.revenueProofUrls || [],
            employeeProofs: data.employeeProofUrls || []
          });
        }
      });

      res.status(200).json({
        message: "Documents Pulled Successfully",
        documents: pulledDocuments
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to pull documents" });
    }
  });

  /**
 * POST Pull Documents
 * Body: { participantId: string, startDate: string, endDate: string }
 */
app.post("/api/incubatees/pull-documents", async (req: Request, res: Response) => {
    try {
      const { participantId, startDate, endDate } = req.body;

      const historyRef = collection(db, `monthlyPerformance/${participantId}/history`);
      const historySnap = await getDocs(historyRef);

      const pulledDocuments: any[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);

      historySnap.forEach((docSnap) => {
        const data = docSnap.data();
        const docDate = new Date(data.createdAt.toDate());
        if (docDate >= start && docDate <= end) {
          pulledDocuments.push({
            month: data.month,
            bankStatements: data.revenueProofUrls || [],
            employeeProofs: data.employeeProofUrls || []
          });
        }
      });

      res.status(200).json({
        message: "Documents Pulled Successfully",
        documents: pulledDocuments
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to pull documents" });
    }
  });

  /**
 * POST Generate Financial Report
 * Body: { participantId: string, startDate: string, endDate: string, type: string }
 */
app.post("/api/incubatees/generate-report", async (req: Request, res: Response) => {
    try {
      const { participantId, startDate, endDate, type } = req.body;

      const historyRef = collection(db, `monthlyPerformance/${participantId}/history`);
      const historySnap = await getDocs(historyRef);

      const start = new Date(startDate);
      const end = new Date(endDate);

      const allTransactions: any[] = [];

      for (const historyDoc of historySnap.docs) {
        const data = historyDoc.data();
        const docDate = new Date(data.createdAt.toDate());

        if (docDate >= start && docDate <= end) {
          const txnSnap = await getDocs(
            collection(
              db,
              `monthlyPerformance/${participantId}/history/${historyDoc.id}/bankTransactions`
            )
          );
          txnSnap.forEach((txn) => allTransactions.push(txn.data()));
        }
      }

      if (allTransactions.length === 0) {
        return res.status(404).json({ error: "No transactions found for this period." });
      }

      // ✅ Here we call your existing financial report generation logic
      // For now, just return mock
      const generatedDoc = {
        type,
        startDate,
        endDate,
        totalTransactions: allTransactions.length,
        transactions: allTransactions
      };

      res.status(200).json({ message: "Report Generated", report: generatedDoc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

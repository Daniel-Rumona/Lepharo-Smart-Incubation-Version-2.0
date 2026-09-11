export type OwnerType = 'SME' | 'Company';

export type DocumentType =
  | 'Balance Sheet'
  | 'Bank Statement'
  | 'Management Accounts'
  | 'Profit & Loss'
  | 'Cash Flow Statement'
  | 'Trial Balance'
  | 'General Ledger'
  | 'Tax Return'
  | 'Audit Report';

export type DocumentStatus = 'Draft' | 'Pending Review' | 'Approved' | 'Rejected';

export interface FinancialDocument {
  id: string;
  title: string;
  documentType: DocumentType;
  ownerType: OwnerType;
  ownerName: string;
  status: DocumentStatus;
  period: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  description?: string;
  attachments: DocumentAttachment[];
  amount?: number;
  currency: string;
  tags: string[];
  version: number;
}

export interface DocumentAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  uploadedAt: string;
}

export interface DocumentMetrics {
  totalDocuments: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  drafts: number;
  totalValue: number;
  documentsThisMonth: number;
  growthPercentage: number;
}

export interface CreateDocumentRequest {
  title: string;
  documentType: DocumentType;
  ownerType: OwnerType;
  ownerName: string;
  period: string;
  description?: string;
  amount?: number;
  currency: string;
  tags: string[];
  attachments: File[];
}

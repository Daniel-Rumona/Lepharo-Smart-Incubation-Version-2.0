import { FinancialDocument, DocumentMetrics } from '@/types/financial';

export const mockDocuments: FinancialDocument[] = [
  {
    id: '1',
    title: 'Q4 2024 Balance Sheet - TechCorp Ltd',
    documentType: 'Balance Sheet',
    ownerType: 'SME',
    ownerName: 'TechCorp Ltd',
    status: 'Approved',
    period: '2024-Q4',
    createdAt: '2024-12-01T10:00:00Z',
    updatedAt: '2024-12-15T14:30:00Z',
    createdBy: 'John Smith',
    description: 'Quarterly balance sheet showing strong financial position',
    amount: 1250000,
    currency: 'ZAR',
    tags: ['quarterly', 'tech', 'approved'],
    version: 2,
    attachments: [
      {
        id: 'att1',
        name: 'balance-sheet-q4.pdf',
        type: 'application/pdf',
        size: 2048576,
        uploadedAt: '2024-12-01T10:00:00Z'
      },
      {
        id: 'att2',
        name: 'supporting-notes.xlsx',
        type: 'application/vnd.ms-excel',
        size: 1024000,
        uploadedAt: '2024-12-01T10:05:00Z'
      }
    ]
  },
  {
    id: '2',
    title: 'November 2024 Bank Statement - Main Account',
    documentType: 'Bank Statement',
    ownerType: 'Company',
    ownerName: 'Our Company Ltd',
    status: 'Pending Review',
    period: '2024-11',
    createdAt: '2024-12-02T09:15:00Z',
    updatedAt: '2024-12-02T09:15:00Z',
    createdBy: 'Sarah Johnson',
    description: 'Monthly bank statement for main operating account',
    amount: 450000,
    currency: 'ZAR',
    tags: ['monthly', 'banking', 'operational'],
    version: 1,
    attachments: [
      {
        id: 'att3',
        name: 'bank-statement-nov-2024.pdf',
        type: 'application/pdf',
        size: 1536000,
        uploadedAt: '2024-12-02T09:15:00Z'
      }
    ]
  },
  {
    id: '3',
    title: 'Management Accounts - RetailPlus Corp',
    documentType: 'Management Accounts',
    ownerType: 'SME',
    ownerName: 'RetailPlus Corp',
    status: 'Draft',
    period: '2024-Q3',
    createdAt: '2024-11-20T16:45:00Z',
    updatedAt: '2024-11-25T11:20:00Z',
    createdBy: 'Mike Chen',
    description: 'Comprehensive management accounts for Q3 performance review',
    amount: 890000,
    currency: 'ZAR',
    tags: ['quarterly', 'retail', 'management'],
    version: 3,
    attachments: [
      {
        id: 'att4',
        name: 'management-accounts-draft.xlsx',
        type: 'application/vnd.ms-excel',
        size: 3072000,
        uploadedAt: '2024-11-20T16:45:00Z'
      }
    ]
  },
  {
    id: '4',
    title: 'Profit & Loss Statement - StartupXYZ',
    documentType: 'Profit & Loss',
    ownerType: 'SME',
    ownerName: 'StartupXYZ Ltd',
    status: 'Rejected',
    period: '2024-Q2',
    createdAt: '2024-10-15T14:20:00Z',
    updatedAt: '2024-10-18T10:30:00Z',
    createdBy: 'Emma Wilson',
    description: 'Q2 P&L statement - requires revision for GAAP compliance',
    amount: 125000,
    currency: 'ZAR',
    tags: ['quarterly', 'startup', 'revision-needed'],
    version: 1,
    attachments: [
      {
        id: 'att5',
        name: 'pl-statement-q2.pdf',
        type: 'application/pdf',
        size: 1024000,
        uploadedAt: '2024-10-15T14:20:00Z'
      }
    ]
  },
  {
    id: '5',
    title: 'Cash Flow Statement - Our Company Ltd',
    documentType: 'Cash Flow Statement',
    ownerType: 'Company',
    ownerName: 'Our Company Ltd',
    status: 'Approved',
    period: '2024-Q4',
    createdAt: '2024-12-10T08:30:00Z',
    updatedAt: '2024-12-12T15:45:00Z',
    createdBy: 'David Brown',
    description: 'Quarterly cash flow analysis showing positive trends',
    amount: 2100000,
    currency: 'ZAR',
    tags: ['quarterly', 'cash-flow', 'positive'],
    version: 1,
    attachments: [
      {
        id: 'att6',
        name: 'cash-flow-q4.xlsx',
        type: 'application/vnd.ms-excel',
        size: 2560000,
        uploadedAt: '2024-12-10T08:30:00Z'
      }
    ]
  }
];

export const mockMetrics: DocumentMetrics = {
  totalDocuments: 24,
  pendingReview: 5,
  approved: 15,
  rejected: 1,
  drafts: 3,
  totalValue: 12750000,
  documentsThisMonth: 8,
  growthPercentage: 23.5
};

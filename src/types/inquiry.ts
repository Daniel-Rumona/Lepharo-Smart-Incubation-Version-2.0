// Inquiry Management Types

export type InquiryStatus = 'New' | 'In Progress' | 'Contacted' | 'Converted' | 'Resolved' | 'Closed' | 'Lost';

export type InquiryPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type InquiryClassification = 'General' | 'Potential';

export type InquirySource = 'Walk-in' | 'Phone' | 'System' | 'Email' | 'Website' | 'Referral' | 'Social Media' | 'Event' | 'SME' | 'Incubatee' | 'Non-Incubatee' | 'Other';

export type InquiryType =
  | 'General Information'
  | 'Incubation Program'
  | 'Funding'
  | 'Mentorship'
  | 'Office Space'
  | 'Training'
  | 'Networking'
  | 'Partnership'
  | 'Other';

export type BusinessStage =
  | 'Idea Stage'
  | 'Startup'
  | 'Early Stage'
  | 'Growth Stage'
  | 'Established'
  | 'Not Applicable';

export type ServiceOfInterest =
  | 'Business Incubation'
  | 'Funding Support'
  | 'Mentorship'
  | 'Office Space'
  | 'Legal Support'
  | 'Marketing Support'
  | 'Technical Support'
  | 'Networking'
  | 'Training Programs';

export type BudgetRange =
  | 'Under R10k'
  | 'R10k - R50k'
  | 'R50k - R100k'
  | 'R100k - R500k'
  | 'R500k - R1M'
  | 'Over R1M'
  | 'To be discussed';

export type Timeline =
  | 'Immediate'
  | 'Within 1 month'
  | '1-3 months'
  | '3-6 months'
  | '6-12 months'
  | 'Over 1 year'
  | 'Flexible';

export type FollowUpMethod = 'Phone' | 'Email' | 'In-person' | 'Video Call';

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
}

export interface InquiryDetails {
  inquiryType: InquiryType;
  department?: string;
  businessStage?: BusinessStage;
  industry?: string;
  servicesOfInterest?: ServiceOfInterest[];
  description: string;
  budget?: BudgetRange;
  timeline?: Timeline;
}

export interface FollowUp {
  nextFollowUpDate?: Date;
  followUpMethod?: FollowUpMethod;
  assignedTo?: string; // User ID
  notes?: string;
}

export interface StatusHistoryEntry {
  status: InquiryStatus;
  changedAt: Date;
  changedBy: string; // User ID
  notes?: string;
}

export interface CommunicationEntry {
  id: string;
  type: 'response' | 'note' | 'follow-up';
  message: string;
  sentBy: string; // User ID
  sentByName: string; // User display name
  sentByRole: string; // User role (SME, Receptionist, etc.)
  sentAt: Date;
  isInternal?: boolean; // true for internal notes, false for external communications
  attachments?: string[]; // File URLs if any
}

export interface Inquiry {
  id: string;
  branchId: string;
  programId?: string | null;
  programName?: string;
  sourceType?: 'Incubatee' | 'Non-Incubatee';
  submittedBy: string; // User ID (may be transferred to receptionist for management)
  originalSubmittedBy?: string; // Original submitter before any ownership transfer
  submittedAt: Date;
  status: InquiryStatus;
  priority: InquiryPriority;
  classification?: InquiryClassification;
  source: InquirySource;
  contactInfo: ContactInfo;
  inquiryDetails: InquiryDetails;
  followUp?: FollowUp;
  statusHistory?: StatusHistoryEntry[];
  communications?: CommunicationEntry[]; // Thread of responses between SMEs and receptionists
  tags?: string[];
  updatedAt: Date;
  isActive?: boolean;
  acknowledgedAt?: Date; // Set the first time staff open or respond to an SME-submitted inquiry
  acknowledgedBy?: string; // User ID of the staff member who acknowledged it
}

// Form data interface for creating/editing inquiries (nested structure)
export interface InquiryFormData {
  contactInfo: ContactInfo;
  inquiryDetails: InquiryDetails;
  priority: InquiryPriority;
  classification?: InquiryClassification;
  source: InquirySource;
  followUp?: Partial<FollowUp>;
  tags?: string[];
  programId?: string | null;
  programName?: string | null;
  sourceType?: 'Incubatee' | 'Non-Incubatee';
}

// Flat form data interface for forms (matches Ant Design form structure)
export interface InquiryFormFields {
  // Contact Info
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;

  // Inquiry Details
  inquiryType: InquiryType;
  department?: string;
  classification?: InquiryClassification;
  businessStage?: BusinessStage;
  industry?: string;
  servicesOfInterest?: ServiceOfInterest[];
  description: string;
  budget?: BudgetRange;
  timeline?: Timeline;

  // Management
  priority: InquiryPriority;
  source: InquirySource;
  tags?: string[];

  // Follow-up
  nextFollowUpDate?: Date;
  followUpMethod?: FollowUpMethod;
  assignedTo?: string;
  followUpNotes?: string;
}

// Query parameters for filtering inquiries
export interface InquiryQueryParams {
  branchId?: string;
  status?: InquiryStatus;
  priority?: InquiryPriority;
  source?: InquirySource;
  inquiryType?: InquiryType;
  submittedBy?: string;
  dateFrom?: Date;
  dateTo?: Date;
  searchText?: string;
  limit?: number;
  offset?: number;
}

// Analytics data structures
export interface InquiryAnalytics {
  totalInquiries: number;
  inquiriesByStatus: Record<InquiryStatus, number>;
  inquiriesBySource: Record<InquirySource, number>;
  inquiriesByType: Record<InquiryType, number>;
  inquiriesByPriority: Record<InquiryPriority, number>;
  conversionRate: number;
  averageResponseTime: number; // in hours
  trendData: {
    date: string;
    count: number;
  }[];
}

// Dashboard summary for receptionists
export interface ReceptionistDashboardData {
  todayInquiries: number;
  weekInquiries: number;
  monthInquiries: number;
  pendingFollowUps: number;
  recentInquiries: Inquiry[];
  urgentInquiries: Inquiry[];
  myStats: {
    totalSubmitted: number;
    conversionRate: number;
    averageResponseTime: number;
  };
}

// Constants for validation and UI
export const INQUIRY_VALIDATION = {
  MAX_SERVICES_OF_INTEREST: 5,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_FOLLOW_UP_NOTES_LENGTH: 1000,
  MAX_STATUS_NOTES_LENGTH: 500,
  MAX_TAG_LENGTH: 50,
  MAX_TAGS: 10
} as const;

export const PRIORITY_COLORS = {
  Low: '#52c41a',
  Medium: '#1890ff',
  High: '#fa8c16',
  Urgent: '#f5222d'
} as const;

export const STATUS_COLORS = {
  New: '#722ed1',
  'In Progress': '#1890ff',
  Contacted: '#13c2c2',
  Converted: '#52c41a',
  Closed: '#8c8c8c',
  Lost: '#f5222d'
} as const;

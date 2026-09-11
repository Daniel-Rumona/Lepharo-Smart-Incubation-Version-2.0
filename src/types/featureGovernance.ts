export type FeatureRecordType =
  | "request"
  | "update"
  | "new-feature"
  | "pipeline";
export type FeatureStatus =
  | "submitted"
  | "planned"
  | "in-progress"
  | "blocked"
  | "released";

export interface AudienceScope {
  roles: string[];
  departmentIds: string[];
  branchIds: string[];
  allDepartments: boolean;
  allBranches: boolean;
}

export interface FeatureMeeting {
  id: string;
  title: string;
  status: "held" | "pending";
  meetingDate?: string;
  dueDate?: string;
  withName: string;
  discussion?: string;
  challenges?: GovernanceChallenge[] | string;
  requests?: string;
}

export interface GovernanceChallenge {
  id: string;
  text: string;
  status: "open" | "resolved";
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

export interface GovernanceMeeting extends FeatureMeeting {
  source?: "meeting" | "direct-challenge";
  relatedFeatureIds: string[];
  createdFeatureIds: string[];
  createdBy: string;
  createdByName: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface FeatureGovernanceRecord {
  id: string;
  programSpecific?: boolean;
  programId?: string | null;
  appliesToAllPrograms?: boolean;
  type: FeatureRecordType;
  title: string;
  description: string;
  status: FeatureStatus;
  progress: number;
  dueDate?: string;
  audience: AudienceScope;
  meetings: FeatureMeeting[];
  whatsNew?: {
    published: boolean;
    headline?: string;
    summary?: string;
    releaseDate?: string;
    imageUrls: string[];
  };
  createdBy: string;
  createdByName: string;
  createdAt?: any;
  updatedAt?: any;
}

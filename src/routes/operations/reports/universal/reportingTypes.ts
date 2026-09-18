import type { Timestamp } from "firebase/firestore";

export interface AssignedIntervention {
    id: string;
    areaOfSupport?: string;
    assigneeId?: string;
    assigneeName?: string;
    assigneeRole?: string;
    beneficiaryName?: string;
    completedAt?: Timestamp;
    computedProgress?: number;
    assigneeCompletionStatus?: string;
    assigneeDecisionAt?: Timestamp;
    assigneeAcceptanceStatus?: string;
    createdAt?: Timestamp;
    departmentId?: string;
    dueDate?: Timestamp;
    feedback?: { rating?: number; comments?: string };
    frequency?: string;
    interventionId?: string;
    interventionTitle?: string;
    movDocumentId?: string;
    notes?: string;
    participantId?: string;
    programId?: string;
    progress?: number;
    smmeNo?: string | null;
    status?: string;
    target?: any;
    timeSpent?: number;
    tracking?: {
        milestonesDone?: any[];
        documentsUploaded?: any[];
        timeSpentHours?: number;
        sessionsLogged?: number;
    };
    type?: string;
    updatedAt?: Timestamp;
    participantCompletionStatus?: string;
    participantAcceptanceStatus?: string;
    assignmentStatus?: string;
    groupAssignmentId?: string;
    groupId?: string;
    groupKey?: string;
    reportGroupMembers?: AssignedIntervention[];
}

export interface ParticipantProfile {
    id: string;
    name?: string;
    gender?: string;
    idNumber?: string;
    age?: number | string;
    dateOfBirth?: Timestamp | string;
    sector?: string;
    province?: string;
    ward?: string;
    blackOwnedPercent?: number;
    femaleOwnedPercent?: number;
    youthOwnedPercent?: number;
    programId?: string;
}

export interface DepartmentScopeOption {
    id: string;
    name: string;
}

export interface ConsultantRow {
    key: string;
    consultant: string;
    assigned: number;
    completed: number;
    pending: number;
    overdue: number;
    completionRate: number;
    avgTurnaround: number;
    avgFeedback: number;
    smes: number;
}

export interface BottleneckRow {
    key: string;
    intervention: string;
    overdue: number;
    pending: number;
    assigned: number;
    avgOpenDays: number;
}

export type ReportingView =
    | "Overview"
    | "Facilitators"
    | "Reach"
    | "Bottlenecks";

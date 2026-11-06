/**
 * The datasets the Data Export page offers, and that dataExportSettings/{departmentId}.allowedDatasets
 * picks from. Plain data in its own module so the always-loaded layout and the settings page can
 * read it without pulling in the export page itself.
 */
export type Dataset = {
    key: string
    label: string
    collection: string
    sheet: string
    group: string
    description: string
}

export const DATASETS: Dataset[] = [
    {
        key: 'smes',
        label: 'SMEs and Applications',
        collection: 'applications',
        sheet: 'SMEs',
        group: 'SMEs',
        description: 'Applicant, business, programme and application information.'
    },
    {
        key: 'participants',
        label: 'Participants',
        collection: 'participants',
        sheet: 'Participants',
        group: 'SMEs',
        description: 'Onboarded participant and beneficiary records.'
    },
    { key: 'interventions', label: 'Interventions', collection: 'interventions', sheet: 'Interventions', group: 'SMEs', description: 'Intervention catalogue and delivery information.' },
    { key: 'assignedInterventions', label: 'Assigned Interventions', collection: 'assignedInterventions', sheet: 'Assigned Interventions', group: 'SMEs', description: 'SME intervention assignments and progress.' },
    { key: 'movs', label: 'Means of Verification', collection: 'movDocuments', sheet: 'MOVs', group: 'SMEs', description: 'Submitted evidence and verification records.' },
    { key: 'users', label: 'System Users', collection: 'users', sheet: 'Users', group: 'People', description: 'User profiles, roles and assignments.' },
    { key: 'timesheets', label: 'Timesheets', collection: 'timesheets', sheet: 'Timesheets', group: 'People', description: 'Clock-ins, clock-outs, hours and locations.' },
    { key: 'leave', label: 'Leave Requests', collection: 'leaveRequests', sheet: 'Leave Requests', group: 'People', description: 'Employee leave requests and decisions.' },
    { key: 'tasks', label: 'Tasks', collection: 'tasks', sheet: 'Tasks', group: 'People', description: 'Assigned tasks, owners, due dates and status.' },
    { key: 'appointments', label: 'Appointments', collection: 'appointments', sheet: 'Appointments', group: 'Engagement', description: 'Scheduled appointments and attendance.' },
    { key: 'inquiries', label: 'Inquiries', collection: 'inquiries', sheet: 'Inquiries', group: 'Engagement', description: 'Incoming inquiries, ownership and outcomes.' },
    { key: 'followUps', label: 'Follow-ups', collection: 'followUps', sheet: 'Follow Ups', group: 'Engagement', description: 'Inquiry follow-up activities.' },
    { key: 'programs', label: 'Programmes', collection: 'programs', sheet: 'Programmes', group: 'Organisation', description: 'Programme setup and status.' },
    { key: 'departments', label: 'Departments', collection: 'departments', sheet: 'Departments', group: 'Organisation', description: 'Department structure and contact information.' },
    { key: 'branches', label: 'Branches', collection: 'branches', sheet: 'Branches', group: 'Organisation', description: 'Branch and centre information.' },
    { key: 'resources', label: 'Resources', collection: 'resources', sheet: 'Resources', group: 'Operations', description: 'Available resources and capacity.' },
    { key: 'allocations', label: 'Resource Allocations', collection: 'resourceAllocations', sheet: 'Resource Allocations', group: 'Operations', description: 'Resource bookings and allocations.' },
    { key: 'expenses', label: 'Expenses', collection: 'expenses', sheet: 'Expenses', group: 'Finance', description: 'Programme and operational expense records.' },
    { key: 'library', label: 'Library Materials', collection: 'libraryMaterials', sheet: 'Library Materials', group: 'Operations', description: 'Reading materials shared with SMEs.' }
]

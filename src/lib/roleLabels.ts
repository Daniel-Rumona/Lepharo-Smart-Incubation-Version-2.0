/** Display names for stored role keys, shared by the account menu and settings. */
const ROLE_LABELS: Record<string, string> = {
    operations: 'Heads Of Departments',
    coordinator: 'Project Coordinator',
    projectadmin: 'Center Coordinator',
    incubatee: 'SME',
    director: 'Director',
    funder: 'Funder',
    receptionist: 'Receptionist',
    receiptionist: 'Receptionist',
    system_admin: 'System Admin',
    employee: 'Employee',
    government: 'Government',
    headsofdepartment: 'Heads Of Departments',
    hod: 'Heads Of Departments',
    center_coordinator: 'Center Coordinator'
}

// Lepharo's own staff: everyone HR manages. SMEs, training SMEs, funders,
// government viewers and system admins are not staff.
const STAFF_ROLE_KEYS = new Set([
    'director',
    'operations',
    'headofdepartment',
    'headsofdepartment',
    'hod',
    'projectadmin',
    'centercoordinator',
    'coordinator',
    'consultant',
    'hr',
    'employee',
    'auxiliary',
    'receptionist',
    'receiptionist',
    'projectmanager'
])

export const isStaffRole = (role?: string): boolean =>
    STAFF_ROLE_KEYS.has(String(role || '').trim().toLowerCase().replace(/[\s_-]+/g, ''))

export const formatRole = (role?: string): string => {
    if (!role) return 'User'

    const normalized = role.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_')
    if (ROLE_LABELS[normalized]) return ROLE_LABELS[normalized]

    return role.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

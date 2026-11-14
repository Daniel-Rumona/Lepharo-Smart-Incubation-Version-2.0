/**
 * The dashboard a signed-in user lands on for their role. Mirrors the final
 * step of the login page's routeSignedInUser (training SMEs to /training,
 * employees to /timesheet, everyone else to /<role>) without its one-off
 * onboarding detours, so links like the 404 page's "Go Home" return people to
 * their portal rather than the public landing page.
 */
export const roleHomePath = (role: string | null | undefined): string => {
    const normalized = String(role || '').trim().toLowerCase().replace(/\s+/g, '_')

    if (!normalized || normalized === 'guest') return '/login'
    if (normalized === 'training_sme') return '/training'
    if (normalized === 'employee') return '/timesheet'
    return `/${normalized}`
}

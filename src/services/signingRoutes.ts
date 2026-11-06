/**
 * Signing pages an agreement template can send an SME to.
 *
 * A system admin picks from this list when adding an agreement template, so the
 * route can never point at a page that does not exist. A signing page is built
 * by a developer, so adding one is a two-step change:
 *   1. add the page and its route in App.tsx
 *   2. register it here
 *
 * The built-in agreements (pre-incubation-contract, moa, gap-analysis) open
 * their own forms by ID and do not appear here.
 */
export type SigningRouteOption = {
    /** In-app route the SME is navigated to when they press Sign. */
    value: string
    /** What the admin sees in the dropdown. */
    label: string
}

export const REGISTERED_SIGNING_ROUTES: SigningRouteOption[] = []

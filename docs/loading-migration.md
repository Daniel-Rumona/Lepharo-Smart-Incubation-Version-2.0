# Loading-state migration

Goal: one loader (`DashboardLoader`) for the few gates that must resolve a role or
department before anything can render; skeletons everywhere else. Then delete
`components/shared/LoadingOverlay.tsx`.

## Rules
- **Gate** (needs role/department/program before it knows what to render): `<DashboardLoader />`.
  Currently: workspace layout, dashboard switcher, reports switcher, route fallback.
- **Everything else**: render the page frame immediately and pass `loading` down.
  - Metric tiles: `<MotionCard.Metric loading={loading} />` (real icon/title, skeleton value).
  - Cards/tables: `<MotionCard loading={loading} skeleton='table' | 'chart' | 'list' | 'stats' | 'text' skeletonRows={n} />`
    (see `components/dashboards/metrics/CardSkeleton.tsx`; pass a node for bespoke shapes).
  - Empty states must be computed from the data (see Where-work-is-stuck / MOV card), never assumed healthy.
- **Saving/submitting** overlays become button `loading` or a modal, not a page loader.

## Phases
| Phase | Scope | Status |
|---|---|---|
| 0 | `MotionCard` skeleton variants, `DashboardLoader`, `LoadingOverlay` shim | done |
| 1 | List pages: interventions, programs, HR employees, operations MOVs, coordinator MOVs, compliance | done |
| 2 | Analytics/chart pages: coordinator/incubatee/funder analytics, funder dashboard, projectadmin reports, monitoring reports, director charts, departmental view | done |
| 3 | Shared pages: allocated, calendar, incubatees, leave, timesheet, documentation, plan, diagnostic, gap, monitoring activity, HR performance, user management, surveys, directors/strategic, operations interventions, funder smes | done |
| 4 | Forms/one-offs: applicant, onboarding, welcome wizard, participant form (saving), ConfirmationOverlay, finance/ROM dashboards' internal overlays; delete the shim | done (blocking overlays now use `<DashboardLoader overlay />`; shim deleted) |

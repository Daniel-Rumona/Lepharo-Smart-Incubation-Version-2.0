# Live assignments update

`index.tsx` is based on the pasted live file, not the local assignments route. Replace `src/routes/operations/assignments/index.tsx` in the live source checkout with this file. No new helper-file imports or dependencies are required.

`changes.diff` compares the pasted original with the replacement.

Behavior:
- Loading Assignments adds missing compulsory interventions to accepted SMEs' DPs for the current department, preserving existing entries and signatures.
- Compulsory interventions can be assigned individually or in groups without department or SME DP confirmation.
- Optional interventions still require both confirmations, including in mixed plans.
- The current definition controls eligibility: turning compulsory off restores the confirmation requirement.
- Monitoring departments such as ROM only count compulsory catalogue interventions as required; optional catalogue entries are not automatically added to every SME.

This single-file update allocates requirements when Assignments loads. Allocation immediately when the compulsory toggle is saved, and the updated SME roadmap labels, require separate changes to those live routes. This replacement does not contain those other route changes.

Validation: five regression tests exercise the helpers embedded in this replacement; TSX syntax transpilation passes. No production build of the live checkout, authenticated browser test, or deployment was performed.

Run tests from the repository root:
`node --test deliverables/live-compulsory-assignments/regression.test.cjs`

## Complete file list from the previous implementation

Modified (5):
- src/routes/operations/interventions/index.tsx
- src/routes/operations/assignments/index.tsx
- src/routes/applications/index.tsx
- src/routes/operations/plan/diagnostic/index.tsx
- src/routes/incubatee/roadmap/index.tsx

Added (3):
- src/services/compulsoryInterventionService.ts
- src/utils/compulsoryInterventions.ts
- scripts/compulsory-interventions.test.cjs

Other modified files in the workspace are not part of this compulsory-intervention change.

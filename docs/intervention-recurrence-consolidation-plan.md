# Intervention recurrence: one stored shape

Drafted 2026-10-31. Not started. Intervention recurrence is stored in up to eight fields across three
places, read by six near-duplicate helper sets that disagree. This plan moves everything onto one
shape, read and written through one module.

## Why

Today a definition can carry `recurring`, `assignmentMode`, `recurrencePreset`, `recurrence {every, unit}`,
`recurrenceStrict`, `recurrenceEnd`, `frequency` and `recurrenceFrequency`. Each was added by a newer
version of the editor and none was removed; `recurrencePatch()` still writes all of them so old readers
keep working. The readers check them in different orders with different vocabularies, which already
causes bugs (see Phase 0).

## Target model

Same three fields on **definitions** (`interventions/{id}`) and **assignments** (`assignedInterventions/{id}`):

| field | values | notes |
|---|---|---|
| `scheduleMode` | `'recurring' \| 'once-off' \| 'ad-hoc'` | replaces `assignmentMode` and `recurring` |
| `recurrence` | `{ every: number, unit: 'week' \| 'month', strict: boolean } \| null` | `null` unless recurring. Bi-weekly = `{2, week}`, quarterly (if kept) = `{3, month}` |
| `recurrenceEnd` | definition only, unchanged | `{ mode, cycles?, endDate? }` |

Removed everywhere: `recurring`, `assignmentMode`, `recurrencePreset`, `recurrenceStrict`, `frequency`,
`recurrenceFrequency`. "Preset" (`weekly` / `bi-weekly` / `monthly` / `as-needed`) stays a UI and
ai-backend API concept, worked out from the stored shape, never stored.

Assignments already mostly match: new assignments get `scheduleMode`, `cycleKey` and
`recurrence {every, unit, strict}`, and `canonicalizeAssignedInterventionWrite` strips the old fields.

**One module, `src/lib/recurrence.ts`** (pure, no Firebase, tested in `recurrence.test.cjs`):
- `readSchedule(...records)` → `{ scheduleMode, recurrence }`. The only reader. Understands every legacy
  field and spelling (`biweekly`, `fortnightly`, `other`, `once`, `interval`, plural units, quarterly,
  yearly) so it works before and after the migration. Precedence: `recurrence` object, then
  `recurrencePreset`, then `frequency`, then `recurrenceFrequency`, with `'other'` treated as no answer.
- `scheduleFields(preset, strict)`: the only writer; returns the three target fields.
- `schedulePreset`, `presetFrom`, `recurrenceMeta`, `formatRecurrence`, `toCycleKey`, `cycleKeyForMode`,
  `cycleKeyToRank`; `expectedIntervalDays` arrives with Phase 5.
- Cycle keys keep today's format, faults included: `every` is ignored (bi-weekly gets weekly keys) and
  `YYYY-Www` uses `year()` with `week()`, which is wrong around New Year. Fixing them changes stored keys,
  so it belongs with the Phase 3 migration.

## Decisions (2026-10-31)

1. **Once-off and ad-hoc stay separate.** Once-off can't be reassigned after completion; ad-hoc asks
   "What is being done?" as free text on assignment and can repeat. The wizard gets a once-off option (Phase 2).
2. **Nothing set means once-off**, as the assignments page does today. (Ad-hoc was considered, but it
   would make the assign form demand free text for these items.)
3. **Quarterly and yearly leave the screens.** `readSchedule` still reads them, so stored values keep working.
4. **Cycle keys don't change in Phase 1.** They're stored on assignments and compared later, so the
   ISO-week and bi-weekly key fixes need their own migration (Phase 3).

The original questions, for the record:

1. **Is once-off different from ad-hoc?** `getInterventionAssignmentMode` treats once-off as "can't be
   reassigned after completion"; the editor only ever writes ad-hoc, the wizard turns once-off into
   as-needed, and reassigning writes once-off for anything not recurring. Recommendation: keep both,
   and add a once-off option to the wizard so editing a seeded once-off item doesn't quietly make it ad-hoc.
2. **Default when nothing is set.** 36 test definitions have no recurrence and no mode. The assignments page
   reads that as once-off, the wizard as as-needed. Recommendation: ad-hoc, which blocks nothing.
3. **Quarterly and yearly.** Parts of the assignments page support them; the editor, wizard, completion
   service and ai-backend don't. No test data uses them. Recommendation: drop them from the
   assignments page, but keep `readSchedule` able to read them in case production has some.

## Phases

Run each against `lepharo-smart-inc` before `lph-smart-inc`. Phases 1–3 are safe to deploy in order
because `readSchedule` accepts both the old and the new fields.

### Phase 0: fix the live bugs (independent, small): built 2026-10-31
Done as below, plus `supportedRecurrenceFrom` now also reads `assignmentMode` (ad-hoc / once-off as
as-needed, as the wizard already does). On test data 8 more definitions resolve (all to as-needed), and
none changes value. Completion only writes `scheduleMode` and `recurrence` to an assignment when the
user picks a frequency, through `assignmentRecurrencePatch`; the definition update is unchanged.

- **As-needed items ask for a frequency at every completion.** The editor saves as-needed as
  `recurrenceFrequency: 'other'`; `supportedRecurrenceFrom` picks `'other'` before `frequency`, gets no
  match, so `needsRecurrence` is true. 7 test definitions are affected.
- **Completion wipes `recurrence.strict`.** `interventionCompletionService.ts:631, 646` applies the full
  `recurrencePatch` to every completed assignment through a raw `transaction.update`, which writes the
  old fields back and replaces `recurrence` with `{every, unit}`. Only patch the assignment when the
  user picked a frequency, and keep `strict`. Update the test at `interventionCompletionService.test.cjs:273`.
- **Bi-weekly MOVs show as weekly.** `movData.parseFrequency` checks `includes('week')` before `'bi'`.
  MOV views and `movBuilder` also expect `'biweekly'` while everything else writes `'bi-weekly'`.
- **Detail modal shows "monthly"** for any recurring record without `frequency` (`InterventionDetailModal.tsx:231`).

### Phase 1: one module, readers switch: built 2026-10-31
Built as `src/lib/recurrence.ts` (tests in `recurrence.test.cjs`). Every reader listed below now uses it;
`interventionRecurrenceService.ts` keeps only the writers and the option list until Phase 2. Checked against
test data: all 86 definitions give the same mode, interval, strictness and cycle key as before, and stored
assignment cycle keys are unchanged. One deliberate change: completion reads an assignment's own
`scheduleMode` first, so 3 test assignments created ad-hoc no longer pick up their definition's later
weekly setting. The unimported copy in `deliverables/live-compulsory-assignments` is left for Phase 4.

- Add `src/lib/recurrence.ts` and tests: a fixture per legacy combination found in the survey below.
- Point every reader at `readSchedule`: `assignments/index.tsx` (`getRecurrenceFromIntervention`,
  `getInterventionAssignmentMode`, `getRecurrenceMetaSafe`, `getEffectiveCycleKey`, `toCycleKey`),
  `interventions/index.tsx` (`openModal`, filter, Flags column), `InterventionWizard.wizardInitialFrom`,
  `InterventionDetailModal`, `interventionCompletionService` (`needsRecurrence`), `movData`,
  `movService`, `data-export`.
- Delete the local duplicates: `presetToRecurrence` and `legacyFrequencyToRecurrence` (two copies
  each, which disagree), `formatRecurrence` (two copies), `derivePresetFromRecurrence`,
  `deriveAssignmentFrequency` (result unused), `supportedRecurrenceFrom`, `needsRecurrenceSelection`
  (no callers), and the local `Recurrence*` types in both pages.
- MOV documents keep their own `frequency` label field (it's what the generated document shows), but
  it's filled from `presetOf(readSchedule(...))`, with one spelling.

### Phase 2: writers write only the target fields
Built 2026-11-01. `scheduleFields` in `src/lib/recurrence.ts` is the only writer. The editor and the completion
dialog's definition update write `scheduleMode` + `recurrence {every, unit, strict}` and delete the old fields
on update. The wizard asks "Can an SME get it more than once?" for as-needed items (ad-hoc or once-off), and the
detail modal shows the answer. Reassigning keeps ad-hoc assignments ad-hoc. Plan copies no longer carry
schedule fields. `recurrencePatch` is gone. Checked: all 86 test definitions open in the wizard and save back to
the same mode and interval. Not done: `artifacts/digital-twin/dataset.json` is generated output and still has
the old fields until `seed.cjs` is next run; `dataset.previous.cjs` is a historical snapshot and is left as is.
A quarterly or yearly definition opened in the wizard still falls back to as-needed, as it did before.

- `interventions/index.tsx onFinish`, `recurrencePatch` callers in completion, assignment create and
  reassign (`assignments/index.tsx:3239, 3523`) all use `scheduleFields`.
- Reassigning keeps the assignment's existing `scheduleMode` instead of turning ad-hoc into once-off.
- `compulsoryInterventions.ts:13` stops copying schedule fields into `diagnosticPlans.interventions[]`;
  the live definition already wins wherever both are read.
- `assignedInterventionService` adds `recurrenceFrequency` to `DEPRECATED_ASSIGNMENT_FIELDS` (missing today).
- Seed scripts and `scripts/digital-twin/dataset.cjs` write the target shape.
- ai-backend `/intervention/design-suggest` keeps its `frequency` / `strict` / `recurrencePreset` API;
  `interventionDesignService` converts with `scheduleFields`. No backend change.

### Phase 3: migrate stored data
Built 2026-11-01, dry run only. Planning is in `scripts/recurrence-migration-plan.cjs` (tests in
`recurrence-migration-plan.test.cjs`), which reads records with `src/lib/recurrence.ts` itself. Assignments are
planned from their own fields only; one that states no schedule is reported rather than given its definition's,
and a missing `strict` stays false, as the app already reads it. Run it with `--key=<path>`;
`--apply` also needs `--project=<that key's project_id>`.

Test project `lepharo-smart-inc`, dry run 2026-11-01: 240 writes (86 definitions, 90 assignments gaining an
explicit `strict: false`, 64 plans losing schedule copies), 0 for manual review. Simulated in memory: every
definition and assignment reads back with the same mode and interval, cycle keys untouched, and a re-run plans
nothing. 4 once-off definitions lose a `recurrenceStrict: false` that only applies to recurring items.
**Applied to `lepharo-smart-inc` 2026-11-01:** 240 writes committed (report:
`scripts/migrate-intervention-recurrence-report-lepharo-smart-inc.json`). A dry run afterwards plans 0 writes.
No definition or assignment carries any old field, every record now states its schedule (definitions: 32
recurring, 45 once-off, 9 ad-hoc; assignments: 92 recurring, 213 once-off, 20 ad-hoc, matching what they read as
before), no plan copy holds schedule fields, and every assignment keeps its cycleKey.
**Production (`lph-smart-inc`) not run.** Deploy Phases 1–2 there first, then dry run with its key and review the list.
The cycle-key fixes (respect `every`, ISO week-year) are not in this script; they change stored
keys and the open-cycle checks, so they need their own decision.

`scripts/migrate-intervention-recurrence.cjs`, same conventions as `migrate-department-ids.cjs`:
dry run by default, `--apply --confirm=migrate-intervention-recurrence`, report to
`scripts/migrate-intervention-recurrence-report.json`.
- `interventions`, `assignedInterventions`, `diagnosticPlans.interventions[]`: set the target fields
  from `readSchedule`, delete the old ones.
- Lists as needs-manual-review: records whose old fields disagree (for example `frequency: 'weekly'`
  with `recurrence {1, month}`), unknown values, and quarterly or yearly. These are left unchanged.
- Run order per project: deploy Phases 1–2, dry run, review the report, then `--apply`.

### Phase 4: remove the legacy fallback
After production is migrated and a re-run of the dry run plans nothing: drop the legacy branches from
`readSchedule`, delete `src/routes/deliverables/live-compulsory-assignments/index.tsx` (an unimported
copy of the assignments page), and the stale `InterventionFrequency` types in `types/intervetion.ts`
and `types/mov.ts`.

### Phase 5: use it in the SME Risk Register
`expectedIntervalDays(schedule)` gives each SME's expected gap between services (shortest among their
active recurring assignments). The risk score's inactivity term becomes days since last service ÷
expected gap, with the fixed 30/90/180-day thresholds as the fallback for ad-hoc and unassigned SMEs.
The same function goes into `functions/src/smeRiskLogic.ts` so the nightly job agrees.

## Survey of test data (`lepharo-smart-inc`, 2026-10-31)

**`interventions`: 86 definitions**
- 28 have no recurrence fields at all, plus 8 with only `recurring: false` and nulls (36 with no recurrence and no mode).
- 7 as-needed definitions store `recurrenceFrequency: 'other'` (the Phase 0 completion bug).
- `assignmentMode` values in use: `recurring`, `ad-hoc`, `once-off`, and missing.
- `strict` appears in both `recurrenceStrict` and `recurrence.strict`, sometimes disagreeing
  (3 with `recurrenceStrict: false` and `recurrence.strict: false`; others with only one set).
- No quarterly or yearly values.

**`assignedInterventions`: 325 assignments**
- Only `recurrence` is set: 233 `null`, 90 `{1, month}`, 2 `{1, week, strict: false}`. None of the old
  fields, so the completion patch hasn't run on test data yet. Production may differ: check the Phase 3 dry run.

## Not affected
Nothing in `functions/src` reads these fields (they use `cycleKey` only), and `firestore.rules`
doesn't reference them. "Frequency" in KPIs, training plans, report templates, feature-governance
meetings and plan-roadmap milestones is a different concept and is out of scope.

# Training Academy course workflow

## Implemented

- Author-owned cloud drafts (`academyDrafts`), optimistic revision checks, autosave, and IndexedDB recovery. Old browser drafts remain available in the course repository and are synchronized when saved.
- Repository deletion is recoverable: it hides a course from the active repository and new learner enrolments while retaining published versions, learner progress, and assignment reviews. Restore it from the Deleted filter to reopen enrolment.
- Course → modules → ordered learning items, with item movement between modules and question navigation independent of the item outline.
- Lesson acknowledgement; facilitator-reviewed assignments; server-graded quizzes/tests; explicit attempt count, pass mark, retained-score policy, and optional server-enforced timer.
- Question-specific reference materials and explanations. No default correct answer or quiz-level upload panel.
- Quizzes and tests have no learning objective of their own. Answer explanations are shown after an attempt only when "Show answer explanations" is on: on by default for quizzes, off by default for tests (`showFeedback`).
- Publishing validation links to the missing item/question. Each publication creates a private grading snapshot (`academyKeys`) and a learner-safe immutable snapshot (`academyVersions`). Existing enrollments keep their original revision.
- Shared `CoursePlayer` for preview and the `/academy/:id` learner route. Quizzes reuse the survey `SurveyQuestionFrame`: one question at a time, answer progress, Previous/Next, Save progress, and submission. Preview simulates progress and approval and never calls the scoring or coaching services.
- Assignment review in the author repository; published catalog at `/academy`; learner links require sign-in. Publication currently makes courses available to all signed-in learners. There is no email distribution action.
- AI practice uses author-provided approved text, a bounded conversation, and a reflection. Completion means participation, not a claim of mastery. Uploaded supporting files are not automatically extracted into the coach's reference text.
- Full-width, side-by-side modal footer actions in the course workflow.

### Guided builder (`src/components/courses/builder/`)

- **Start** (`/training/courses/builder`): build from documents, describe the course, or start blank. AI drafts an outline the author edits (rename, untick) before anything is saved. On phones the start is two steps (choose a mode, then the brief) with a mode switcher in the header.
- **Create course and draft content** saves the outline, opens the builder and drafts every item in the background (lessons first, then quizzes/tests written from those lessons). Drafted items carry `aiDraft` until the author marks them reviewed; it never blocks publishing.
- **Builder** (`/training/courses/builder/:id`): sticky header, a Next step bar that always names the most useful fix (with a one-click AI or manual action), readiness per item in the outline, and a tabbed editor (Content/Questions/Instructions/Settings, advanced assessment options under More options).
- **AI inside items**: draft with AI, simplify, shorten, add a local example, suggest objective, suggest marking criteria, write instructions, generate questions from chosen lessons, suggest missing outline items, suggest a course description. Every rewrite appears as a suggestion to accept or discard.
- **AI-suggested answers** are stored with `aiSuggested: true` and `validateCourse` reports `confirmAnswer` until the author confirms or picks another option, so publishing is blocked server-side too. `publicCourse` strips both AI flags.
- **Preview** is a full-screen learner view (desktop/phone, reset progress, unlock all, edit this item). The learner route uses the same redesigned `CoursePlayer`: contents sidebar (drawer when narrow), readable formatted content (`RichText`), plain-language status labels.
- Validation issues now carry a `code` (and `moduleId` for module issues) so the builder can map each problem to its fix.

### AI backend endpoints (`ai-backend/app.py`)

All require a Firebase ID token from a course author role and `GEMINI_API_KEY`. `ACADEMY_LOCALE` (optional, default South Africa) sets the country used in examples.

| Endpoint | Purpose |
| --- | --- |
| `POST /academy/outline` | Outline from a brief or up to 3 documents (items carry source `notes` in documents mode) |
| `POST /academy/draft-item` | First draft of a lesson, assignment, quiz or test; quizzes/tests are written from supplied lessons |
| `POST /academy/assist` | simplify, shorten, example, objective, rubric, instructions, description |
| `POST /academy/suggest-items` | Up to 4 items that close gaps in an outline |
| `POST /academy/extract-content` | Fill one item from an uploaded document |

## Backend setup before hosted use

No functions, rules, or secrets were deployed by this implementation.

1. Confirm the intended Firebase project using the team's normal release process.
2. Configure secret `ACADEMY_GEMINI_API_KEY` with Firebase Secret Manager (`firebase functions:secrets:set ACADEMY_GEMINI_API_KEY`). Never place this key in a client/Vite environment variable.
3. Set `ACADEMY_GEMINI_MODEL` to an available model approved for this environment. The coach uses Google's documented [generateContent REST API](https://ai.google.dev/api/generate-content).
4. Build functions using `npm.cmd --prefix functions run build`.
5. Test the new Firestore and Storage rules in an emulator, using separate author and learner accounts. The existing generic Firestore fallback must exclude all five new academy collections; otherwise it overrides the narrower permissions.
6. Deploy only the intended changes: `firebase deploy --only functions:academyAction,functions:academyCoach,firestore:rules,storage` after reviewing the full rules diff. The repository contains unrelated work; do not deploy unrelated functions or commit unrelated changes.
7. Deploy the frontend through the project's normal release workflow, then run the acceptance checks below.

The API key/model must be configured before deploying the AI callable. Rules and callable functions are required for publishing, enrollment, grading, review, and coaching. Author drafts and recovery do not substitute for deploying the cloud permissions.

## Verification performed

- `node --test scripts/academy.test.cjs`: 17 focused tests at the time of implementation. Tests exercise the real domain and callable handlers using an in-memory transaction adapter and a mocked Gemini response. They are **not** Firestore/Storage emulator tests or live AI verification.
- Functions TypeScript build passed.
- Frontend TypeScript check still has unrelated baseline errors; no academy/courses diagnostics were reported in the focused scan.
- Full production Vite build was blocked by sandbox configuration access; the elevated retry was declined.
- Authenticated browser and deployment checks remain outstanding.

## Acceptance checks after deployment

1. Create two modules, a lesson, a file assignment, a 20-question quiz, a timed test, and AI practice. Change module order and move an item. Check desktop/mobile material rows and sticky header.
2. Leave an answer unset and publish: review must link to that question. Select a radio answer, publish v1, and open the learner route as a different account.
3. Reload an incomplete draft and learner attempt. Simulate a failed cloud save; the UI must show unsynced state and offer the newer local recovery on reopening. Open an author draft in two tabs and confirm stale revisions cannot silently overwrite the newer one.
4. Verify sequential gating, acknowledgement, marking criteria, submission files, revision requests, and author approval. Learners must not approve their own work or read private grading snapshots.
5. Save quiz answers, reload, submit once, retry, and exhaust attempts. Verify best/latest scores. After a timed attempt expires, changing the request body must not change the previously saved answers used for grading.
6. Publish v2 while a learner is enrolled in v1. Their question text and grading rules must remain v1.
7. Run real AI practice with approved reference text, confirm messages resume, then complete the required exchanges and reflection. Failed requests must not falsely complete the item.

## Boundaries

There is no certification, enrollment reassignment, targeted invitation list, automatic rubric grading, or automated proof that a lesson's material was understood. Assignment completion requires the author's review. Publishing and course completion do not alter the platform's intervention lifecycle records.

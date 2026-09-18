# My Workspace: Tasks, Calendar, Today, and Analytics

## Delivery brief

This is a **planning and implementation-review guide only**. It proposes no application changes in this document and records no application-code changes.

The scope is the **My Workspace** operational center and its four intended sections:

1. **Today** — the signed-in user's actionable day, approvals, alerts, recent activity, receipts, and follow-ups.
2. **Tasks** — personal, team, parent/child, checklist, dependency, assignment, reminder, and operational work.
3. **Calendar** — appointments, meetings, participants, responses, reminders, clashes, and task deadlines.
4. **Analytics** — authorized operational throughput, aging, overdue, workload, cycle-time, and burn-down analysis.

The checked-out implementation currently contains only the first three sections. Analytics is a new fourth-section candidate selected during the post-review decision round.

All proposed application work is divided into **exactly three PRs** in this guide.

## Evidence and interpretation rules

- **Current** means confirmed by the checked-out routes, implementation, migrations, tests, or scripts.
- **Meeting** means explicitly demonstrated, requested, or discussed in the 17 September 2026 Meeting 4 transcript supplied for this review.
- **Decision** means selected by the user after the deeper codebase review.
- **Recommendation** means an implementation or product proposal derived from the evidence. It is not presented as an existing behavior or a direct transcript quote.

The raw transcript is treated as stronger evidence than the generated meeting summary when the two differ. The raw discussion covers parent tasks, child work, milestones, deadlines, operations-file links, performance analysis, and notifications. It does not define a dependency graph precisely; the final decision nevertheless places dependency delivery in the Tasks work, so the implementation contract below defines the minimum safe semantics instead of leaving the feature as an undefined label.

The corporate-entity, website, document, treasury, currency, and financial-dictionary topics from the same meeting remain outside this guide, except where a Workspace task links to an operations file or another record.

## Decisions recorded after the deeper review

| Decision area | Selected response | Consequence for this guide |
|---|---|---|
| Canonical navigation | **Path-based canonical URLs plus a legacy adapter** | Use `/workspace` for Today, `/workspace/tasks`, `/workspace/calendar`, and `/workspace/analytics`; translate old `/workspace?tab=...` links rather than breaking existing notifications and bookmarks. |
| Visibility | **Least-privilege record-owner, assignee, invitee, and scope rules** | Keep task Mine/Team/All scope controls, enforce the same policy on task detail and mutation, and make event detail, invitation, response, and Analytics authorization explicit rather than identifier-based. |
| Today | **Actionable open work with overdue carry-over** | Default to open work, overdue carry-over, visible invited events, and the approved actionable deadline policy; hide completed and cancelled work by default and expose honest failure and truncation states. |
| Task structure | **Parent/child tasks plus separate checklist, dependencies included now** | Use `parent_task_id` for separately assigned operational children, retain `task_subtask` for lightweight checklist or milestone steps, and deliver a safe blocked-by dependency model in the Tasks release rather than deferring it. |
| Analytics | **A fourth `/workspace/analytics` section with scope-matched data** | Add a real section, screen definition, permission metadata, authorized aggregations, and drill-downs. Keep operational performance separate from Empower HR appraisal and KPI-rating records. |
| Calendar collaboration | **Tenant-timezone collaboration with organizer and invitee controls** | Normalize and display in the tenant workplace timezone, make invited events visible according to the least-privilege policy, add participant controls and notifications, and apply the same normalized clash behavior on create and update. |

## Product intent: My Workspace as the operating desk

My Workspace should answer these operational questions in one visit:

1. What needs my attention today.
2. What work is assigned to me or my team.
3. What meetings, appointments, and deadlines are coming up.
4. Which approvals, alerts, receipts, and follow-ups are waiting.
5. Which work is late, blocked, overloaded, or completed.
6. Where the underlying task, operation file, approval, event, or record can be opened immediately.

Today, Tasks, Calendar, and Analytics are different views of one authorized work set. They must not become four independent data products with conflicting definitions of ownership, due dates, completion, visibility, or time.

## Codebase review: current implementation and contracts

### Navigation, routing, and screen registration

**Current evidence**

- `client/src/app/layout/areas.ts` registers My Workspace with exactly `today`, `tasks`, and `calendar` sections.
- `client/src/features/workspace/hub.tsx` passes those same three components to `TabbedHub`.
- `client/src/app/app.tsx` mounts `/workspace` and `/workspace/:section` to `WorkspaceHub`.
- `client/src/components/tabbed-hub.tsx` selects the active section from the route parameter and uses the same section data for the ribbon and the responsive fallback tab strip.
- `client/src/app/layout/areas.test.ts` verifies that hub sections and screen registry entries agree.
- `client/src/app/screen-registry.json` contains `workspace`, `workspace_today`, `workspace_tasks`, and `workspace_calendar`; it contains no Analytics screen.
- `packages/shared/rules/entity-route.js` currently emits task and calendar links as `/workspace?tab=tasks&task=...` and `/workspace?tab=calendar&event=...`.
- `client/src/features/workspace/tasks/tasks-page.tsx` consumes `/workspace/tasks?task=...`, and `client/src/features/workspace/calendar/calendar-page.tsx` consumes `/workspace/calendar?event=...`. The hub does not consume the old `tab` query parameter.

**Required navigation contract**

- `/workspace` is the Today landing route.
- `/workspace/today` is a supported explicit Today alias.
- `/workspace/tasks` is the Tasks route.
- `/workspace/calendar` is the Calendar route.
- `/workspace/analytics` is the new Analytics route.
- Record selection remains a query state on the canonical section, for example `task=<id>` or `event=<id>`.
- `view`, `audience`, and the calendar cursor or visible date range must be shareable URL state where they affect what a copied link shows.
- Old query-tab links are accepted by a compatibility adapter and translated to the canonical path. New producers use only the canonical path.
- A record link must open the correct section, preserve the intended selection long enough for the screen to load it, and respect the same authorization check as an in-page click.

### Today and the workspace roll-up

**Current evidence**

- `client/src/features/workspace/today.tsx` renders the day timeline, Awaiting me, Unread alerts, Recent activity, Cash to account for, and create actions.
- `client/src/features/workspace/hooks.ts` uses `useDay()` and `useReceiptsOwed()` as separate React Query reads.
- `src/modules/dashboard/workspace/workspace.controller.js` owns the `/workspace` roll-up and the tenant-local default window for `/workspace/day`.
- `src/modules/dashboard/workspace/workspace.service.js` composes approval rows, unread notifications, and owed receipts.
- `src/modules/dashboard/workspace/workspace.repo.js` filters approval rows by role and approvable module for ordinary users and gives the CEO a broader path.
- `src/modules/dashboard/workspace/tasks.service.js` merges task due dates and event start times in `mergeTimeline()`.
- `src/modules/dashboard/workspace/tasks.repo.js` supplies `tasksInRange()`, `listEvents()`, and `subtasksInRange()`.
- `client/src/features/workspace/today.test.tsx` covers the roll-up panels, links, empty states, recent activity, and owed receipts. It does not cover the server day composition or actionable filtering.

**Current behavior that must be corrected or made explicit**

- `/workspace/day` defaults to a tenant-timezone day, but the task query is a strict due-date window. Open overdue tasks before the window are not carried into Today.
- The merged day includes tasks with any status when their due date is in range, including DONE and CANCELLED rows.
- The day event read uses creator ownership. An invited internal participant is not included merely because they are invited.
- Subtask deadlines are available through `/workspace/deadlines` for Calendar, but they are not part of the merged Today timeline.
- Task and event reads have hard result limits, while the day response reports returned counts and no truncation metadata.
- `workspace.repo.safe()` converts some roll-up query failures into empty arrays. `TodayPage` also replaces the whole Today surface with a day error screen when `useDay()` fails, and it does not give the approvals, notifications, or owed-receipts panels a clear unavailable state.
- The approval query is more carefully scoped than the UI contract alone suggests, but a best-effort empty result is still indistinguishable from a failed query in the current roll-up path.

### Tasks

**Current evidence**

- `migrations/tenant/13810_workspace_tasks_events.sql` defines `task` with title, description, status, priority, assignee, creator, due date, completion time, `parent_task_id`, generic entity link fields, personal flag, scope, reminders, soft deletion, and audit timestamps.
- The same migration defines `task_subtask` as a checklist with title, done flag, display order, completion time, and parent task relation, and defines `task_watcher` as a user join table.
- `migrations/tenant/13822_task_subtask_deadline.sql` adds an optional deadline to checklist steps but deliberately adds no step reminder pair.
- `migrations/tenant/13820_workspace_task_permissions.sql` grants broad create/update authority and restricts delete authority to the seeded administrative roles. The service still has to enforce record visibility and mutation scope.
- `migrations/tenant/13840_workspace_recurrence.sql` adds recurrence series and cursor fields plus unique occurrence indexes.
- `src/modules/dashboard/workspace/tasks.validator.js` accepts `parent_task_id` on create, but not on update, and the client `TaskInput` and `TaskDialog` do not expose it.
- `src/modules/dashboard/workspace/tasks.service.js` and `tasks.repo.js` implement Mine, Team, and All task visibility, personal-task protection, assignment notifications, subtasks, watchers, reminders, recurrence, record-link derivation, and status transition logic.
- `client/src/features/workspace/tasks/tasks-page.tsx` provides audience selection, board/list switching, desktop master-detail, mobile task sheet, and task deep-link handling.
- `client/src/features/workspace/tasks/task-board.tsx` provides mouse, touch, keyboard, and Move-menu status changes. Existing tests cover gesture behavior and the open-card layout.
- `client/src/features/workspace/tasks/task-list.tsx` provides a server-paged, searchable, filterable list alternative.
- `client/src/features/workspace/tasks/task-panel.tsx` provides task detail, record opening, status editing, checklist ticking, checklist deadlines, and deletion.
- `client/src/features/workspace/tasks/task-dialog.tsx` provides title, notes, status, priority, due time, assignment, personal flag, reminders, and recurrence.
- `packages/shared/rules/entity-route.js` derives record destinations rather than storing routes on tasks, which is the correct shared-link architecture to preserve.

**Current behavior that must be corrected or extended**

- Board and list audience selection does not flow into `useTask()` or the task mutation detail path. A task visible in Team or All can fail the detail endpoint’s default Mine check when opened from the board.
- Board drag and Move-menu transitions use the dedicated status endpoint, but the detail status select and the edit dialog send generic PATCH requests. They therefore do not share the dedicated status audit and notification behavior.
- The board endpoint is capped at 200 rows and does not return a truncation indicator. The list is the completeness path, but the board does not tell the user when it is incomplete.
- The parent-task column is present in schema and create validation but absent from the task form, parent/child reads, child assignment flow, and progress roll-up.
- Checklist subtasks have no independent assignee, status vocabulary, or dependency relation. Their deadline control is date-only, so the meeting requirement that deadlines can matter within one day is not fully represented.
- Watcher storage and endpoints exist, but the panel has no add/remove controls and adding a watcher does not provide a user-facing manual ping workflow.
- Task assignment notification exists for create and some reassignment paths, but there is no explicit user-triggered ping, no visible watcher management, and no comprehensive recipient behavior for all collaboration changes.
- The reminder backend accepts both relative minutes and an explicit `remind_at`, but the current task and event dialogs expose only fixed presets. A user cannot enter a custom time, and a recurring item without an anchor date can carry a rule that never spawns.
- Generic linked-record fields exist in the API, but the task dialog has no operations-file picker or explicit linked-record control. A task can be linked only when another client or caller supplies the entity fields.
- There is no dependency table, cycle check, dependency API, blocked state, or dependency-aware Analytics.

### Calendar

**Current evidence**

- `migrations/tenant/13810_workspace_tasks_events.sql` defines `calendar_event` with event type, location, description, start/end instants, all-day flag, recurrence, creator, reminders, generic entity links, and soft deletion.
- The same migration defines `calendar_participant` with internal or external attendee identity, response state, response time, organizer flag, uniqueness, and indexes.
- `src/modules/dashboard/workspace/tasks.repo.js` uses an overlap predicate for event windows and supports event participants, clashes, reminders, and recurrence copies.
- `src/modules/dashboard/workspace/tasks.service.js` resolves event input on the tenant timezone, checks create-time location clashes, returns participants, and spawns recurring event rows.
- `client/src/features/workspace/calendar/calendar-page.tsx` offers month and week views, event deep links, event creation, and task-deadline navigation.
- `calendar-grid.tsx`, `week-view.tsx`, and `dates.ts` index multi-day events and task/subtask deadline chips.
- `event-dialog.tsx` supports event CRUD, all-day mode, location, recurrence, reminders, and create-time clash confirmation.
- `client/src/features/workspace/hooks.ts` and `api.ts` expose event, deadline, participant, and response helpers, but the current page does not mount participant management.

**Current behavior that must be corrected or extended**

- `getEvent()` does not apply the list visibility predicate. A caller with a known event identifier can retrieve an event and participants even when the list would not show it, and the same unchecked detail path gates event edits, deletion, participant addition, response, and removal.
- Event lists default to creator-only. Internal invitees are not automatically included in Calendar or Today, despite participant rows and reminder fan-out existing.
- Participant response and removal use the general workspace edit permission and do not restrict response to the invited user or management of the participant to an organizer or authorized manager.
- The event dialog does not display or edit participants, has no invite notification flow, and does not expose response state.
- The reminder worker sends the organizer and participant users, but the event dedupe key is `event-reminder:<event id>` rather than recipient-specific. The notification service claims dedupe keys globally for the process or Redis window, so the first recipient can suppress later recipients. The production key must include the recipient user ID.
- Create-time clash detection queries raw user input before tenant-timezone normalization. Update-time clash detection is absent, and `force` has no equivalent update path.
- Calendar month and date indexing use browser-local conversions while the server stores tenant-local wall input as UTC instants. Editing a record from a browser in another timezone can shift its wall-clock value.
- The month view uses an exclusive `to` range that does not add the final visible day. Events and deadlines starting on the last visible date can be omitted from the fetched range.
- Calendar handles the event query error but not the deadline-query error. A failed deadline overlay can look like a calendar with no task deadlines.
- Calendar cursor state is held in component state, so a copied month or week URL does not reproduce the same visible range.

### Time, recurrence, and background jobs

- `src/modules/dashboard/workspace/workspace.time.js` correctly treats zoneless input as tenant workplace time and explicit-offset input as an instant. This server-side rule is sound and must remain authoritative.
- `client/src/features/workspace/tasks/task-dialog.tsx`, `event-dialog.tsx`, and `calendar/dates.ts` currently convert instants through browser-local `Date` methods before sending or indexing them. The client must display tenant-local values without reinterpreting the resulting wall clock as browser-local input.
- `src/modules/dashboard/workspace/recurrence.js` and `src/jobs/handlers/workspace-reminder.js` support daily, weekly, monthly, and yearly recurrence plus reminder sweeping and occurrence spawning.
- `workspace-reminder.js` correctly sends task reminders to the assignee or creator and event reminders to organizer and participant users, stamps rows even after delivery failure, and runs recurrence spawning beside the reminder sweep.
- `migrations/tenant/13840_workspace_recurrence.sql` protects task and event occurrence idempotency with unique indexes and preserves occurrence history.
- Existing recurrence tests cover next-occurrence calculation, counts, until dates, cursor advancement, participant/checklist copying, and tenant-time conversion. They do not cover a no-anchor recurring item through the UI or all update-scope combinations.

### Existing test evidence and limitations

Relevant existing tests include:

- `tests/unit/workspace-tasks-rules.test.js` for visibility helpers, reminder derivation, links, timeline ordering, and validator contracts.
- `tests/unit/workspace-tasks-sql.test.js` for visibility SQL, task/subtask SQL, event overlap predicates, reminder queries, and parameter binding.
- `tests/unit/workspace-recurrence.test.js` and `workspace-recurrence-spawn.test.js` for recurrence vocabulary and materialization.
- `tests/unit/workspace-reminder-sweep.test.js` for recipient selection, failure disarming, links, and worker formatting.
- `tests/unit/workspace-time.test.js` for tenant timezone conversion and DST cases.
- `client/src/features/workspace/api.test.ts` for unwrapped API envelopes and board metadata.
- `client/src/features/workspace/repeat.test.ts` for recurrence picker round trips.
- `client/src/features/workspace/tasks/task-board.test.tsx` and `tasks-page.test.tsx` for gesture fallback, master-detail, mobile sheet, and task links.
- `client/src/features/workspace/today.test.tsx` for the roll-up panels and their links.

Missing or insufficient evidence includes Calendar component tests, event list/detail/mutation authorization tests, invited-event visibility tests, update clash tests, participant UI and response tests, recipient-specific event reminder dedupe tests, browser-versus-tenant UI timezone tests, Today server composition tests, Analytics tests, dependency tests, and end-to-end cross-surface flows.

The targeted suites were attempted during review, but this checkout lacks the test runners (`jest` and `vitest` were not installed). No runtime test pass is claimed here.

## Meeting 4 requirements mapped to implementation

| Meeting evidence | Product requirement | Current implementation | Planned treatment |
|---|---|---|---|
| 00:18:03–00:19:11 | Today shows the user’s day, unread alerts, approvals or validations awaiting the user, recent activity, and cash that must be reconciled. | The panels and roll-up endpoints exist, but failure and actionability states are incomplete. | PR 1 makes the panels independently trustworthy and keeps deep links to the full queues. |
| 00:20:25–00:21:37 | Tasks and calendar make scheduled work visible, with weekly and monthly views. | Month/week views and task deadline overlays exist. | PR 1 defines the shared time and visibility contract; PR 3 closes range, timezone, deadline, and mobile gaps. |
| 00:24:02–00:26:18 | A task can repeat daily, be assigned, carry a time, and remind the assignee before it is due. | Assignment, presets, recurrence, reminders, and worker spawning exist. | PR 2 adds anchor validation, custom reminders, complete assignment/ping behavior, and round-trip tests. |
| 00:28:34–00:29:42 | Kanban drag had a defect and a Move menu is an important fallback. | Drag sensors and Move menu have substantial coverage, but detail and dialog status paths bypass the dedicated transition route. | PR 2 standardizes every status path and adds server-backed rollback and authorization tests. |
| 00:30:41–00:35:58 | Managers split a file’s work among employees, link work to an operations file, create work referenced to a main task, track milestones, and inspect workflow. | Generic entity fields and a database parent field exist, but no picker, child workflow, dependency model, or parent roll-up exists. | PR 2 delivers operations-file linking, parent/child tasks, checklist milestones, dependencies, and progress roll-ups. |
| 00:37:04–00:38:07 | A user can ping or notify someone from a task, and deadline times matter within a day. | Assignment notification and worker reminders exist; manual ping, watcher UI, and subtask time controls do not. | PR 2 adds collaboration actions and precise deadline handling. |
| 00:40:48–00:42:10 | Interactive team-performance and burn-rate analysis, delayed-task views, charts, and possible automated queries, distinct from HR appraisals and KPI ratings. | No Workspace Analytics section or contract exists; HR appraisal surfaces are separate. | PR 2 adds `/workspace/analytics` with scope-matched operational metrics and explicitly excludes HR rating semantics. |
| 00:43:32 | Improve poor text quality and punctuation. | Workspace copy is present but has no dedicated final editorial gate. | Every PR includes copy review, with a final cross-surface pass in PR 3. |
| Meeting summary plus raw discussion | Subtask dependencies were mentioned as an Analytics concern. | No dependency schema or behavior exists, and the raw transcript leaves semantics undefined. | User decision includes dependencies now; PR 2 defines blocked-by edges, cycle prevention, visibility, and roll-up behavior. |

## Confirmed bugs

### B-01 — Shared entity links use a route contract the hub does not consume

`packages/shared/rules/entity-route.js` emits query-tab links, while `TabbedHub` activates `/workspace/:section` and the feature pages consume section-local query parameters. Notifications and reminders can therefore arrive on Today without opening the referenced task or event.

**Target:** path-based canonical links with a compatibility adapter for legacy query-tab links, plus route tests for notification, reminder, Today, Calendar, and copied links.

### B-02 — Calendar and task URL state is incomplete

Tasks store view and audience in query state, but local audience state is initialized only once and Calendar keeps its cursor in component state. Back/forward and copied calendar URLs can show a different view from the URL.

**Target:** derive section state from URL state, clone and update search parameters safely, and serialize visible date, view, audience, and selection as appropriate.

### B-03 — Team and All task cards can fail when opened

The task list/board sends an audience to the board endpoint, but `useTask()` does not send it to the detail endpoint. `getTask()` defaults to the request’s Mine audience. A manager can see a card in Team or All and still receive a task-not-found result when opening it.

**Target:** pass the effective audience through detail and mutation reads, then re-check the server predicate rather than trusting the client-selected audience.

### B-04 — Status mutations have inconsistent audit and notification semantics

Board drag and Move use `POST /tasks/:id/status`; the Task Panel status select and Task Dialog edit form use generic PATCH. The same user action is therefore represented as `task.status_changed` in one path and `task.updated` in another.

**Target:** route every status transition through the dedicated service operation, including form edits, with one audit, completion timestamp, and notification contract.

### B-05 — Today’s default does not prioritize actionable work

The day query includes completed and cancelled tasks due today, excludes overdue carry-over, and does not include invited-only events or child deadlines. This contradicts the selected actionable Today contract.

**Target:** open work plus overdue carry-over, authorized invited events, approved child deadlines, clear status filters, and aligned counts.

### B-06 — Today and roll-up panel failures can appear as empty success

The `safe()` helper returns an empty list after a query failure. Today does not distinguish unavailable approvals, alerts, or receipts from a true empty state, and a day query error hides all the other panels.

**Target:** independent loading, empty, unavailable, stale, and truncated states for each panel, with retry and observability.

### B-07 — Day and board caps are not advertised

`tasksInRange()` and `listEvents()` cap results, and the board caps open tasks at 200, but Today and the board expose no `truncated` or total indicator.

**Target:** return result metadata, display a clear completeness state, and provide the paged List/Analytics drill-down as the authoritative full result.

### B-08 — Event detail bypasses event visibility

`getEvent()` reads any non-deleted event by identifier without checking creator, invitee, scope, or tenant-wide authority. Every event mutation first calls that method, so the same bypass reaches edit, delete, participant, and response operations.

**Target:** centralize event visibility and mutation policy and apply it to list, detail, mutation, participant, Today, Calendar, and notification links.

### B-09 — Participant actions are not least privilege

Any caller passing the general workspace edit permission can respond to or remove a participant if the event ID and participant ID are known. The current API does not require self-response for an invitee or organizer/manager authority for invitation administration.

**Target:** enforce organizer/authorized manager controls and self-response controls in the service, not only in the UI.

### B-10 — Client read/write conversion can shift tenant-local times

The server’s `workspace.time.js` contract is tenant-local, but the client’s `toLocalInput()`, `dayInput()`, `isoDay()`, and event/task grid logic use browser-local Date methods. An operator working in a timezone different from the tenant can edit an existing instant and silently submit a different tenant wall time.

**Target:** create a shared tenant-local display/serialization contract, test it with a browser timezone different from the tenant, and keep all-day day boundaries consistent.

### B-11 — Calendar range and deadline failures are silent or incomplete

The month fetch does not add the exclusive final visible day, and the page handles the event query error but not the deadline query error. A last-day event or deadline can be omitted or a failed overlay can look empty.

**Target:** compute one explicit half-open visible range and render independent event/deadline states and retries.

### B-12 — Clash detection is create-only and not normalized consistently

Create checks raw input before the service resolves it to tenant instants. Update does not check clashes at all, and `force` has no update behavior.

**Target:** normalize first, use the same overlap predicate on create and update, exclude the edited row, and require an explicit force action for either save path.

### B-13 — Event reminders can suppress later recipients

The worker loops over organizer and participants, but it passes the same event-level dedupe key to every notification. The notification service claims that key globally for its dedupe window. The key must be recipient-specific.

**Target:** `event-reminder:<event id>:<user id>` or an equivalent per-recipient idempotency key, with a production-shaped test that exercises the real claim path.

### B-14 — Calendar collaboration exists in schema but not in the screen

Participants, response states, recurrence copying, and reminder recipient selection exist in migrations and backend code. `event-dialog.tsx` does not let a user invite, see, remove, or respond to participants, and adding a participant does not send an invitation notification.

**Target:** participant UI, response controls, organizer state, invitation notifications, and participant-aware deep links.

### B-15 — Parent tasks and linked operation files cannot be created from the current UI

The schema contains `parent_task_id`, and generic `entity_type`/`entity_id` links are derived by the shared route map, but the task dialog supplies neither a parent selector nor an operations-file picker. There is no child-task list or parent progress view.

**Target:** parent/child task workflow, separate checklist workflow, operations-file picker, and authorized linked-record navigation.

### B-16 — Watchers and manual pings are backend-shaped but user-incomplete

Watcher tables and endpoints exist, but no panel controls add or remove watchers and no explicit task ping action exists. Assignment notification is not a substitute for a user-triggered ping or follow workflow.

**Target:** watcher management, manual ping with recipient-specific dedupe, notification preferences, and audit entries.

### B-17 — Recurrence can be configured without a usable anchor

The recurrence picker can be used with no due date or event start, while occurrence spawning depends on `due_at` or `start_at`. The resulting row carries a rule but never materializes an occurrence.

**Target:** require an anchor for recurrence, explain the rule in the UI, and test create, edit-this, edit-series, until, count, and timezone behavior.

### B-18 — Checklist deadlines do not support intraday milestone precision

The server stores a subtask instant, but `task-panel.tsx` uses a date-only field for checklist deadlines. The meeting specifically called out deadline times that matter within one day.

**Target:** a tenant-local date/time control for milestone steps or a deliberate product statement that only parent tasks carry time precision.

### B-19 — Analytics has no route, screen, API, data model, or permission contract

The current area list, hub, registry, and workspace API contain no Analytics implementation. The meeting request cannot be satisfied by renaming a Tasks filter.

**Target:** fourth-section route and registration, authorized aggregations, drill-downs, chart accessibility, performance limits, and separation from HR appraisal data.

## Improvements and additional features

### Operational navigation and links

- Keep one shared entity-route map for notifications, task links, event links, reminders, Today rows, and Analytics drill-downs.
- Add explicit compatibility handling for old query-tab links and test every route against the real router.
- Preserve selection, view, audience, and visible date range in shareable URL state.
- Make every link honest about whether it opens the exact record or only its containing list.
- Add a global “open in Workspace” convention for approval, notification, task, deadline, and event destinations.

### Today

- Add quick actions for complete, move, snooze, open, and create where permissions permit, while keeping the dedicated status transition endpoint authoritative.
- Show overdue carry-over separately from today’s scheduled work while keeping one chronological actionable list.
- Include invited events and child deadlines according to the selected least-privilege policy.
- Return totals, visible counts, and truncation metadata from every capped read.
- Let each panel retry independently and distinguish empty, unavailable, stale, and partially loaded states.
- Keep approvals, alerts, receipts, and recent activity as links to their authoritative full screens rather than duplicating their business logic.

### Tasks and workflow structure

- Provide an operations-file picker that writes the correct `dossier` or operations entity reference and opens through the shared route map.
- Provide parent and child task creation with separate assignees, due dates, statuses, reminders, and visibility checks.
- Keep checklist subtasks lightweight, with optional milestone deadlines, and do not silently treat them as independently assigned tasks.
- Add progress roll-up from child tasks and checklist steps without rewriting historical completion.
- Add a dependency graph with cycle prevention and clear blocked semantics.
- Add manual pings, watchers, recipient-level dedupe, and notification preference behavior.
- Expose custom reminder times, recurrence anchors, series edit scope, and recurrence completion state.
- Add board completeness metadata and make the paged List view the full-data fallback.
- Ensure all status changes have identical audit, completion timestamp, notification, and optimistic rollback behavior.

### Calendar

- Make event visibility and mutation authorization explicit for creator, invitee, organizer, manager, scope, and tenant-wide authority.
- Add participant search, external attendee entry, response status, organizer controls, and invite notifications.
- Apply tenant-local time display and input consistently, including all-day events and month/week indexing.
- Add normalized clash warnings on create and update with an explicit force action.
- Add participant-specific event reminder idempotency and test real delivery behavior.
- Add quick event capture from Today and day cells without nested interactive controls or accidental new-event creation.
- Consider a day/time-grid view only after the month/week/agenda contract is reliable; it is not required for the Meeting 4 core closure.

### Analytics

The selected fourth section should begin with operational, not HR, metrics:

- open work by status, owner, scope, and priority;
- overdue count and overdue aging;
- throughput completed per period;
- cycle time from creation to completion;
- workload distribution and assignment concentration;
- blocked work and dependency aging;
- operational burn-down of open work over a selected period;
- drill-down lists that reuse the exact authorized task query;
- export or automated-query hooks only where the same visibility contract can be enforced.

“Performance” in this section must not become an appraisal score, compensation input, or employee KPI rating. Those remain in Empower HR appraisal and KPI surfaces and require their own permissions and retention rules.

### Content quality

- Review all Workspace headings, empty states, action labels, date descriptions, pluralization, punctuation, and error messages.
- Use one vocabulary for task, child task, checklist step, milestone, dependency, deadline, reminder, invite, and response.
- Keep labels translatable and avoid raw enum or database identifiers in user-facing copy.

## Authorization and data contracts selected for planning

### Task visibility

- **Mine** means assigned to the caller or created by the caller.
- **Team** means Mine plus rows in the caller’s authorized organigramme scope closure and explicitly unscoped operational rows, subject to personal-task protection.
- **All** requires the tenant-wide permission scope and still does not expose another person’s personal task unless the caller is its creator or assignee.
- The effective audience must travel through board, list, detail, Today, Calendar deadlines, mutations, and Analytics drill-downs. A query parameter is never itself authority.
- Parent tasks, child tasks, checklist deadlines, and dependencies inherit the visibility of the underlying task set. A dependency edge must not reveal the title or existence of an unauthorized task.

### Event visibility and mutation

- A creator or organizer can see and manage the event within their workspace authority.
- An invited internal participant can see the event and respond to their own invitation.
- A manager or tenant-wide viewer can see additional events only through an explicit scope or module grant.
- Invitation administration, organizer changes, participant removal, and event deletion require organizer or explicitly authorized management authority.
- Detail, list, Today, Calendar, reminders, and all mutation routes must call the same service-level visibility policy.
- External attendees receive no account-level response capability unless a later public invitation flow is designed.

### Today actionability

- Default Today shows open visible tasks due today, overdue visible tasks carried forward, visible invited/organized events, and included actionable milestone deadlines.
- DONE and CANCELLED rows are hidden by default but may be available through an explicit history filter.
- The user can distinguish schedule time from deadline time and see why an item is present.
- Counts and truncation metadata must describe the same filtered set shown in the list.

### Parent, child, checklist, milestone, and dependency model

The selected first-release model is deliberately explicit:

- `parent_task_id` represents a separately assigned operational child task. It is not a recurrence-series link and not a checklist row.
- `task_subtask` remains the lightweight checklist or milestone-step structure. It may carry a title, done state, order, and optional tenant-local deadline.
- A milestone that needs its own owner, status, reminders, or Analytics row is a child task. A milestone that only records a step is a checklist subtask.
- Child tasks inherit the parent’s linked operation context by default but retain their own authorization and assignment checks.
- Parent progress is derived from child task and checklist state; it must not falsify historical status or completion timestamps.
- Dependencies are directed `blocked-by` edges between tasks. A task is blocked while an unresolved dependency is not DONE. CANCELLED dependencies require an explicit override or replacement rather than silently satisfying the edge.
- Self-dependencies and cycles are rejected. The database and service must both prevent duplicate edges and cross-tenant references.
- Dependency visibility is the intersection of the two task visibility rules. A blocked indicator may be shown without disclosing an unauthorized dependency’s title or owner.
- Analytics counts blocked work using the same dependency and visibility rules.

### Time contract

- The tenant workplace timezone is authoritative for zoneless input, Today windows, Calendar ranges, due dates, event starts, reminders, recurrence, and all-day boundaries.
- A client may display a localized representation, but it must not submit a browser-local wall clock as if it were the tenant wall clock.
- Visible date ranges use half-open intervals `[from, to)` with `to` equal to the first instant after the visible range.
- Calendar month, week, agenda, Today, reminders, and Analytics must agree on the same tenant-local date interpretation.

### Analytics contract

- `/workspace/analytics` is a real fourth section and is registered in `areas.ts`, the route table, `screen-registry.json`, and permission metadata.
- Metrics use the same authorized task population as Tasks and Today. Aggregated charts must not disclose excluded rows through totals, bins, labels, or drill-down counts.
- Operational burn-down means work-volume movement, not financial cash burn and not employee appraisal.
- Aggregations require bounded date ranges, server-side limits, stable definitions, and an accessible tabular alternative.

## Acceptance contract

### Global Workspace acceptance

- Every canonical Workspace URL loads the intended section through the hub and responsive fallback.
- Legacy notification and reminder links translate to the canonical path and open the intended record when authorized.
- Browser back/forward and copied links reproduce selected section state, visible date range, audience, and record selection.
- Unauthorized identifiers return the same safe not-found or forbidden behavior regardless of whether the user arrived from a list, notification, reminder, or direct URL.
- Tenant-local time behavior remains correct when the browser timezone differs from the tenant timezone.
- Workspace copy has no raw enum leakage, ambiguous empty state, or avoidable punctuation defect.

### Today acceptance

- Today shows actionable open work, overdue carry-over, authorized events, and the selected milestone deadline set.
- Approvals, alerts, receipts, recent activity, and the day timeline load independently.
- Each panel distinguishes loading, empty, unavailable, stale, and truncated results.
- Completed and cancelled rows are absent by default and available only through an explicit history path.
- Each row opens its authoritative approval, notification, receipt, task, event, or record destination.
- Counts reconcile with the visible filtered set and advertise any cap.

### Tasks acceptance

- Mine, Team, and All cards open and mutate only when the server authorizes the caller.
- Board drag, Move menu, detail status select, and edit dialog all use the same server transition semantics.
- Mouse, touch, keyboard, and Move-menu paths produce one audit and one notification outcome.
- Board truncation is explicit and the paged List view is complete for the declared filters.
- A manager can link an operations file, create separately assigned child tasks, add checklist milestones, add valid dependencies, and see progress from Today and Analytics.
- Dependencies reject cycles and hidden-task disclosure.
- Watchers, manual pings, assignment notifications, reminders, and recurrence edits have recipient-specific and series-correct behavior.
- Custom reminder values and daily, weekly, monthly, and yearly recurrence survive create and edit without silent loss.

### Calendar acceptance

- Month, week, agenda, Today, deadline overlay, and reminder views agree on the same tenant-local event and deadline set.
- Multi-day events appear on every visible day they overlap, and the final exclusive date is included correctly.
- Event and deadline failures are independently visible and retryable.
- Mobile users can open an existing event or deadline without opening a new-event dialog accidentally.
- Event list, detail, create, update, delete, invitation, response, and reminder recipients all use explicit least-privilege rules.
- Organizers can manage invitations; invitees can respond only to their own internal invitation.
- Create and update clash checks use the same normalized instants and explicit force behavior.
- Every intended internal recipient receives one event reminder, including the organizer where policy requires it.

### Analytics acceptance

- Analytics is reachable as the fourth Workspace section and is present in ribbon, mobile fallback, route, registry, and permission metadata.
- Throughput, aging, overdue, workload, cycle-time, blocked-work, and burn-down definitions are documented beside their API contract.
- Chart totals reconcile with authorized drill-down rows and bounded filters.
- A user cannot infer unauthorized task identities or counts from chart bins, totals, exports, or empty states.
- No Analytics output is written into or treated as an HR appraisal or KPI rating.
- Charts have accessible table/list alternatives and clear no-data, unavailable, and truncated states.

## Test and evidence plan

The three PRs must add or update, at minimum:

- canonical path, legacy adapter, record selection, refresh, back/forward, ribbon, mobile fallback, and query-state tests;
- screen registry and fourth-section route tests;
- independent Today panel failure, empty, stale, overdue, invited-event, subtask, and truncation tests;
- approval visibility tests for direct user, role, open, module, and unauthorized rows;
- task detail tests with Mine, Team, and All audiences, including a Team/All task opened from the board;
- status-route tests for board, Move menu, detail select, and edit dialog;
- server-backed drag failure, rollback, and permission tests;
- board truncation and List completeness tests;
- operations-file, parent-task, child-task, checklist milestone, dependency, cycle, watcher, ping, custom reminder, and recurrence-anchor tests;
- Calendar range tests at month boundaries, half-open final dates, multi-day events, invited visibility, and tenant/browser timezone differences;
- Calendar accessibility, mobile nested-interaction, day agenda, and deadline selection tests;
- event list/detail/mutation authorization tests for creator, invitee, organizer, manager, and unauthorized identifiers;
- create and update clash tests with normalized tenant instants and force behavior;
- participant invitation, self-response, organizer management, invitation notification, reminder delivery, and recipient-specific dedupe tests;
- Analytics aggregation authorization tests that compare chart totals with authorized drill-down rows;
- end-to-end flows from notification or reminder to the canonical section and back to Today/Tasks/Calendar/Analytics.

The implementation work should not be marked complete solely because the existing pure unit tests pass. The missing cross-surface and authorization cases above are the evidence required for closure.

# Three-PR delivery plan

## PR 1 — Workspace foundation, canonical navigation, authorization, and Today trust

### Scope

- Establish path-based canonical Workspace URLs and a legacy query-tab adapter.
- Update shared entity-route producers and client consumers to one canonical deep-link contract.
- Add URL state for section selection, Task audience/view, Calendar visible date/view, and record selection.
- Add the shared service-level event visibility and mutation authorization foundation.
- Keep tenant workplace timezone authoritative for Today and Calendar range construction, and define the client display/serialization boundary used by later work.
- Correct Today actionability: open work, overdue carry-over, authorized invited events, selected actionable deadlines, and hidden completed/cancelled defaults.
- Return totals and truncation metadata for capped Today reads.
- Make approvals, alerts, receipts, recent activity, day timeline, and deadline reads independent with retryable unavailable states.
- Preserve full approval and notification screens as authoritative destinations rather than duplicating them.
- Add route, visibility, Today composition, timezone contract, and editorial tests.

### Not in this PR

- Parent/child task and dependency UI.
- Analytics implementation.
- Full Calendar participant UI and event invitation flow.
- Final mobile Calendar redesign.

### Exit criteria

- Every supported task, event, approval, notification, receipt, and deadline link lands on the correct canonical section or an honest authorized not-found state.
- Legacy query-tab links continue to work through the adapter.
- Today remains useful when any one panel fails and clearly distinguishes unavailable from empty.
- Today uses the selected actionable and overdue policy and advertises caps.
- Event detail no longer bypasses the list visibility policy.
- Tenant-local date boundaries are testable and stable across browser timezone differences.

## PR 2 — Tasks hierarchy, collaboration, dependencies, and operational Analytics

### Scope

- Pass effective audience through task detail and mutation paths while keeping authorization server-side.
- Route all status changes through the dedicated status transition behavior.
- Close the Kanban defect with server-backed drag, Move, keyboard, rollback, and permission coverage.
- Add board completeness metadata and preserve the full paged List path.
- Add operations-file picker and linked-record presentation.
- Add parent/child operational tasks using `parent_task_id` while retaining checklist subtasks as a separate concept.
- Add checklist milestone deadlines with agreed intraday precision.
- Add dependency storage, blocked-by semantics, duplicate and cycle prevention, visibility intersection, and progress roll-up.
- Add watcher management and manual task pings.
- Add custom reminder times, recurrence-anchor validation, series edits, and recipient-specific notification behavior.
- Add the fourth `/workspace/analytics` section, route, registry metadata, permission metadata, server aggregations, bounded filters, accessible charts/tables, and authorized drill-downs.
- Keep Analytics operational and separate from Empower HR appraisal and KPI-rating records.
- Add task hierarchy, dependency, collaboration, Analytics, authorization, and metric-reconciliation tests.

### Not in this PR

- Full Calendar participant UI.
- Calendar month/week mobile redesign.
- External calendar synchronization.

### Exit criteria

- A manager can link an operations file, create and assign child tasks, add checklist milestones, add valid dependencies, and follow progress from Today and Analytics.
- A Team or All task opened from the board remains readable and mutable only when authorized.
- Every status-changing gesture has identical transition, audit, notification, and rollback semantics.
- Dependencies cannot self-reference, cycle, leak unauthorized task details, or silently mark unresolved work complete.
- Analytics totals reconcile with the authorized task list and expose no HR appraisal meaning.
- Custom reminders and recurrence remain anchored, tenant-local, and series-correct.

## PR 3 — Calendar collaboration, tenant-time UI, mobile usability, and final polish

### Scope

- Apply the shared tenant-time display and input contract to task deadlines, Calendar dates, month/week indexing, all-day events, and agenda rows.
- Correct half-open month/week ranges, multi-day event indexing, final-day inclusion, and independent event/deadline loading states.
- Add participant search, external attendee entry, organizer controls, self-response, response display, invitation notifications, and least-privilege mutation enforcement.
- Correct event reminder dedupe to be recipient-specific and test the real notification claim path.
- Add normalized clash checks on create and update with explicit force behavior.
- Add mobile day agenda and accessible month-cell/item interaction without nested action ambiguity.
- Add event linked-record picker and canonical event deep links.
- Add Calendar filter/search and quick capture where they fit without compromising the core view.
- Complete the final Today–Tasks–Calendar–Analytics consistency, wording, punctuation, accessibility, and end-to-end pass.

### Not in this PR

- External-calendar synchronization unless separately approved within this same Calendar scope.
- A financial cash-burn model unrelated to Workspace task work.
- A new HR appraisal or employee KPI-rating system.

### Exit criteria

- Month, week, agenda, Today, deadlines, and reminders show the same authorized tenant-local event set.
- Mobile users can open existing events and deadlines without accidental creation.
- Organizers and invitees receive only the controls their policy allows.
- Event create and update clash behavior is normalized and identical.
- Each intended participant receives one reminder and invitation behavior is observable.
- The complete Workspace surface passes the cross-surface route, authorization, timezone, accessibility, and editorial acceptance suite.

# Six decision questions

The six questions below were asked through the post-review decision round. Suggested responses and the recommendation are retained here as the decision record.

### 1. Which canonical deep-link contract should My Workspace use?

The implementation evidence is the mismatch between `TabbedHub` route parameters, section-local query selection, and the old `entity-route.js` query-tab links.

- Path-based canonical URLs only, with no compatibility behavior.
- Query-tab URLs as the canonical contract, with the hub changed to consume them.
- **Path-based canonical URLs plus a legacy adapter (Recommended).** Use `/workspace`, `/workspace/tasks`, `/workspace/calendar`, and `/workspace/analytics`, while translating old query-tab links.

**Recorded response:** Path-based canonical URLs plus a legacy adapter.

### 2. What visibility and mutation policy should Tasks, Calendar, Today, and Analytics share?

The implementation evidence is the task audience predicate alongside the missing event detail check, creator-only event list, and broad participant routes.

- **Record-owner, assignee, invitee, and scope rules (Recommended).** Apply least privilege consistently and use the same authorized set for Analytics.
- Creator-owned Calendar with administrative participant metadata only.
- Shared team Calendar managed by any user with workspace edit permission.
- Tenant-wide visibility and mutation for all users with MOD-00A access.

**Recorded response:** Least-privilege record-owner, assignee, invitee, and scope rules.

### 3. What should the default Today contract prioritize?

The implementation evidence is the strict due-date window, creator-only event read, inclusion of completed/cancelled tasks, omitted overdue carry-over, omitted child deadlines, and unreported caps.

- **Actionable open work with overdue carry-over (Recommended).** Include authorized invited events and approved actionable child deadlines, hide completed/cancelled items by default, and expose independent error/truncation states.
- Strict tenant-local day rows, including completed/cancelled items that fall in the window.
- Full daily history with filters for actionability.

**Recorded response:** Actionable open work with overdue carry-over.

### 4. What task structure should the first Tasks release deliver?

The implementation evidence is `parent_task_id` in the schema but not the UI, checklist-only `task_subtask`, and no dependency model.

- Parent/child tasks plus separate lightweight checklist, with dependencies deferred.
- Enhanced checklist only, with assignee/status/dependency-like fields on subtasks.
- **Parent/child tasks plus dependencies now (Recommended).** Use `parent_task_id` for separately assigned children, retain checklist subtasks, and deliver a defined blocked-by model in the Tasks release.
- Checklist only.

**Recorded response:** Parent/child tasks plus dependencies now. The user explicitly requested that this scope not be deferred.

### 5. Where should operational performance analysis live and what should it mean?

The implementation evidence is exactly three current Workspace sections and no Analytics route, screen, API, or data contract, alongside the meeting request for team performance, burn-rate, delayed-task views, charts, and possible automated queries.

- **Fourth `/workspace/analytics` section with scope-matched operational metrics (Recommended).** Start with throughput, aging, overdue, cycle-time, workload, blocked work, and work burn-down, with authorized drill-downs and no HR appraisal data.
- Fourth section restricted to managers and separate Empower permissions.
- Analytics inside Tasks.
- Defer Analytics and keep only Today, Tasks, and Calendar.

**Recorded response:** Fourth `/workspace/analytics` section with scope-matched data.

### 6. What Calendar collaboration contract should the implementation target?

The implementation evidence is tenant-timezone resolution on the server but browser-local client round trips, participant schema without participant UI, missing invitation notifications, create-only clash checking, and event-level reminder dedupe.

- **Tenant-timezone collaboration with organizer and invitee controls (Recommended).** Normalize create and update, show authorized invited events, add organizer/self-response controls, invite notifications, recipient-specific reminder dedupe, and identical force behavior.
- Personal Calendar first, with participant UI and shared visibility deferred.
- Manager-managed shared Calendar, with invitees receiving reminders but not managing their own response.

**Recorded response:** Tenant-timezone collaboration with organizer and invitee controls.

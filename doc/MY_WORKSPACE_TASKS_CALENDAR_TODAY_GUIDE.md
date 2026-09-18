# My Workspace: Tasks, Calendar, and Today

## Delivery brief

This is a planning and review guide only. It proposes no application implementation in this document and records no changes to the application code.

The scope is the new **My Workspace** tab and its three existing sections:

- **Today**: the signed-in user's actionable day and roll-ups.
- **Tasks**: personal, team, and tenant task execution.
- **Calendar**: appointments, meetings, and task deadlines.

All proposed application work is grouped into **exactly three PRs** at the end of this guide.

## Evidence and interpretation rules

Three evidence labels are used throughout:

- **Current** means confirmed by the checked-out code, routes, tests, migrations, or changelog.
- **Meeting** means explicitly demonstrated, requested, or agreed in the 17 September 2026 Meeting 4 transcript supplied for this review.
- **Recommendation** means a product or engineering improvement inferred from the goal of making the new tab reliable, efficient, and useful. It is not presented as a direct transcript requirement.

The transcript contains both Gemini-generated notes and a raw transcript. The raw transcript is treated as the stronger source when the summary and spoken discussion differ. The summary says that subtask dependencies were discussed; the raw discussion clearly covers parent tasks, child tasks, milestones, deadlines, operations-file links, performance analysis, and notifications, but does not define a dependency model.

The Control Tower requirements in the earlier kickoff transcript are not silently attributed to Today, Tasks, or Calendar. Global search, role-filtered KPIs, notifications, clock-in, and Meeting Management remain adjacent product context. This guide only carries the parts that affect this workspace surface: deep links, notifications, recent activity, approvals, and the distinction between operational task analytics and HR appraisals.

## Product intent for the new tab

My Workspace should be the user's dependable operating desk rather than a second dashboard. It should answer, in one visit:

1. What needs my attention today.
2. What work is assigned to me or my team.
3. What meetings, appointments, and deadlines are coming up.
4. Which approvals, alerts, receipts, and follow-ups are waiting.
5. Which operational work is late, blocked, overloaded, or completed.
6. Where the relevant task, operation file, approval, or event can be opened immediately.

The new-tab principle is important. A user may arrive from the ribbon, a notification, an approval link, a task link, a calendar link, or a browser bookmark. Every entry point must land on the same canonical section, preserve the intended selection, and respect the same authorization rules.

## Current implementation inventory

### Already present

- `client/src/app/layout/areas.ts` registers **My workspace** with Today, Tasks, and Calendar.
- `client/src/features/workspace/hub.tsx` supplies the three section components.
- `client/src/app/app.tsx` serves `/workspace` and `/workspace/:section`.
- `client/src/components/tabbed-hub.tsx` provides shared tab semantics, deep-linkable sections, responsive fallback tabs, ribbon coordination, and keyboard behavior.
- Today already combines a day timeline with approvals, unread notifications, recent activity, and cash-to-account-for content.
- Tasks already has a Kanban board, a paginated list alternative, audience selection, a task detail pane or mobile sheet, subtasks, reminders, recurrence, assignment, and record links when a task already contains an `entity_type` and `entity_id`.
- Calendar already has month and week presentations, event creation and editing, event reminders, location clash warnings on create, recurrence, and task/subtask deadline overlays.
- The backend has tenant-timezone conversion utilities, recurrence materialization, reminder sweeping, task watchers, calendar participants, participant responses, and event/task audit events.
- The current recurrence implementation and tests support daily, weekly, monthly, and yearly rules. The Meeting 4 promise of daily, weekly, monthly, and yearly recurrence is therefore substantially represented in the current code.
- Assignment notification delivery and scheduled task/event reminders exist in the backend. The missing part is the user-facing manual ping, watcher management, and complete notification behavior around the workflow.

### Important current design constraints to preserve

- Today, Tasks, and Calendar are views of one workspace queue, not three unrelated applications.
- The server must remain authoritative for visibility, permissions, tenant timezone, recurrence meaning, and reminder timing.
- Task status changes have a dedicated endpoint because they carry audit and notification consequences.
- Events have participants and response states in the schema even though the current event dialog does not expose them.
- A task checklist subtask is not the same thing as a separately assigned child task. Meeting 4 needs both concepts kept distinct.
- Approvals and notifications have full screens. Today should summarize them and deep-link to those screens rather than create a second competing implementation.

## Meeting 4 requirements captured from the transcript

| Transcript evidence | Requirement or observation | Current status | Classification |
|---|---|---|---|
| 00:18:03–00:19:11 | Today should show the user's today list, unread alerts, approvals or validations awaiting the user, recent activity, and cash that must be reconciled. | Most panels exist. Error and visibility behavior is not trustworthy enough yet. | Meeting requirement |
| 00:20:25–00:21:37 | Task dates and calendar views should make scheduled work visible; weekly and monthly calendar views were demonstrated. | Month and week views exist. Range, timezone, deadline, and agenda defects remain. | Meeting requirement |
| 00:24:02–00:26:18 | A task can repeat daily, be assigned to a person, carry a time, and remind the assignee before the due time. | Daily, weekly, monthly, and yearly recurrence, assignment, time, and reminders are represented. Several edge cases remain. | Meeting requirement |
| 00:28:34–00:29:42 | Dragging a Kanban card between stages had a bug. A Move menu is an important fallback. | Changelog and tests show substantial drag work, including touch behavior. Real server-backed regression coverage is still required before calling the meeting defect closed. | Confirmed historical bug; closure pending |
| 00:30:41–00:35:58 | Managers need to split a file's work among employees, link work to an operations file, create tasks referenced to a main task, track milestones, and inspect the resulting workflow. | Generic record links exist only when data is supplied; there is no operations-file picker or parent-task workflow in the UI. | Meeting requirement |
| 00:37:04–00:38:07 | A user should be able to ping or notify someone from a task, and deadline times matter because some actions fit within one day. | Assignment notifications and reminders exist. Manual task pings, watcher management, and subtask time fields are missing. | Meeting requirement |
| 00:40:48–00:42:10 | Add interactive team-performance and burn-rate analysis, delayed-task views, charts, and possible automated queries. Keep this distinct from periodic HR appraisals and KPI ratings under Empower. | No performance section exists. | Meeting requirement with permission boundary |
| 00:43:32 | Review poor text quality and punctuation in the interface. | Text quality is a cross-cutting concern and should be included in the workspace acceptance pass. | Meeting observation |
| Meeting summary | Subtask dependencies were mentioned as an analytics concern. | No dependency data model or UI is present, and the raw discussion does not define its semantics. | Additional feature requiring definition |

The corporate-entity, website, document, treasury, currency, and financial-dictionary items in the same meeting are deliberately outside this guide, except where a workspace task may link to an operations file or another record.

# Confirmed bugs and gaps

## A. Navigation and new-tab bugs

### A1. Notification deep links do not match the hub's routing contract — high priority

**Current:** `packages/shared/rules/entity-route.js` emits task and event links in the form `/workspace?tab=tasks&task=<id>` and `/workspace?tab=calendar&event=<id>`. `TabbedHub` selects a section from the route parameter, not the `tab` query parameter. Today does not consume those task or event query parameters. A notification can therefore land on the Today page without opening the referenced task or event.

**Required outcome:** Choose one canonical deep-link contract and use it everywhere. The safest existing contract is `/workspace/tasks[task=<id>]` and `/workspace/calendar[event=<id>]`, with a compatibility adapter or redirect for old links. Notification, reminder, Today, Calendar, task, and shared entity-route links must resolve to the same section and selection.

**Acceptance:** A task reminder, event reminder, notification, Today row, and copied browser URL all open the same record in the correct section on desktop and mobile. Refreshing after the selection has been intentionally closed does not unexpectedly reopen it.

### A2. Section state is only partly shareable — medium priority

**Current:** Tasks stores view and audience in query state, while Calendar stores view but keeps its month or week cursor in component state. A calendar month cannot be shared as a stable URL. Browser back/forward changes can also leave the Tasks audience state out of sync with the query parameter because the local state is initialized only once.

**Required outcome:** Treat section, selection, view, audience, and calendar cursor as one documented URL state contract. Strip only one-shot selection parameters after a successful open, not before the target section has consumed them.

### A3. Permission-aware controls are not consistently reflected in the UI — medium priority

**Current:** Backend routes protect task and event create, edit, delete, and participant operations. The task panel and event dialog still render Edit, Delete, New, and participant-capable surfaces without checking the corresponding grant. A user with a valid view grant but no delete grant can be offered a destructive control and discover the restriction only after a failed request.

**Required outcome:** Hide or disable unavailable actions with a concise explanation, while retaining backend authorization as the final authority. The same rule must cover audience switches, performance data, event participant changes, and manual pings.

## B. Today bugs and trust problems

### B1. One day-query failure hides usable panels — high priority

**Current:** `TodayPage` places approvals, unread alerts, the day timeline, recent activity, and cash reconciliation inside the `q.error` branch for `useDay`. If `/workspace/day` fails, the entire page shows the day error and hides panels whose requests could still succeed.

**Required outcome:** Give each Today panel independent loading, success, empty, permission, and error states. A failed day timeline must not hide approvals, notifications, recent activity, or receipts owed.

### B2. Failed approval and notification reads look like empty queues — high priority

**Current:** `workspace.repo.js` deliberately converts approval and notification query errors into empty arrays through `safe()`. `TodayPage` ignores the `useResource` error returned by the `/workspace` roll-up. “Nothing awaiting me” and “You are all caught up” can therefore mean either genuinely empty or unavailable.

**Required outcome:** Preserve partial rendering but expose a visible, non-alarming stale or unavailable state. Include a retry action and a diagnostic-safe reason. Do not tell a user that all is clear when the data source failed.

### B3. The approval filter does not fully encode “awaiting me” — high priority

**Current:** The workspace approval query filters pending rows by role and module. It ignores the `assigned_user_id` column and intentionally keeps rows with null role or module visible to everyone. That may be valid for open approval steps, but it is not the same as a direct-user queue and is not clearly represented in Today.

**Required outcome:** Define and enforce the approval audience as direct assignee, eligible role, eligible module, or explicitly open step. Surface the assignment reason in the queue. Add authorization tests for direct assignment, role assignment, open assignment, and CEO behavior.

### B4. Overdue work disappears from Today — high priority

**Current:** `tasksInRange` returns only tasks whose due instant is inside the requested day. A task due yesterday and still open is absent from Today, although the page says “Everything that wants you today.”

**Required outcome:** Put overdue open work in an explicit carry-over section or at the top of Today. Keep completed and cancelled history available behind an intentional filter rather than presenting it as actionable work.

### B5. Today omits subtask deadlines and uses a different event audience — medium priority

**Current:** Calendar deadlines include task and subtask due dates, but the Today timeline includes only parent tasks and events created by the current user. An invited participant's event and a child step due today can be absent from the user's main daily queue.

**Required outcome:** Today and Calendar must share the same visibility contract. Include invited events for the participant, and show actionable subtask deadlines with a parent label. Avoid double-counting a parent task and its child step.

### B6. Today includes completed and cancelled tasks without a clear action mode — medium priority

**Current:** `tasksInRange` does not exclude DONE or CANCELLED tasks. The timeline can therefore contain work that no longer wants action, which conflicts with the “what wants me” promise and can inflate its task count.

**Required outcome:** Default to actionable open tasks plus overdue carry-over. Offer a clearly labelled completed or history filter when the user needs an audit view.

### B7. Today has silent truncation and non-clickable summaries — medium priority

**Current:** Backend windows cap task and subtask results at 200, event results at 500, and Today panels display only eight rows. There is no “showing 8 of N” or truncation indicator. Approval and alert rows themselves are not individually actionable; only the panel-level links open the full queue.

**Required outcome:** Return totals or an explicit `truncated` flag, show overflow affordances, and make each row open its target when a safe route exists. Preserve the full-screen queues as the source of truth.

### B8. Tenant time and browser time can disagree — high priority

**Current:** The server correctly defaults Today to the tenant timezone, but client formatting and Calendar indexing use the browser-local timezone. A user outside the tenant timezone can see an event under the wrong day, see the wrong time, or receive inconsistent Today, Calendar, and task detail displays.

**Required outcome:** Return the tenant timezone or a display-time contract from the API and use one formatter for all workspace surfaces. Test a user in a different timezone around midnight and DST boundaries.

## C. Tasks bugs and gaps

### C1. Team or all-board task detail can 404 — high priority

**Current:** Tasks can be listed in `team` or `all` audiences, but `useTask(taskId)` does not send the selected audience. `getTask` defaults to the request's absent audience, usually `mine`, so a task visible on a team or all board can return 404 when opened. Mutations can make the same mistake.

**Required outcome:** Carry the resolved audience or an authorization context into detail and mutation requests, or make the server resolve visibility independently of a UI query while preserving the same access rule. Add deep-link tests for creator, assignee, team member, tenant-wide user, and unauthorized user.

### C2. The detail status picker bypasses the dedicated status endpoint — high priority

**Current:** Dragging and the list Move menu use `POST /tasks/:id/status`, which emits status-change audit and event records. The TaskPanel status select uses generic `PATCH /tasks/:id`, so a status change made in the detail pane can bypass the dedicated status behavior.

**Required outcome:** Route every status transition through one service path. Ensure completed timestamps, audit records, notifications, recurrence behavior, and Today invalidation are identical whether the user drags, uses Move, or changes the detail picker.

### C3. The Kanban drag defect is historically confirmed but not closed end to end — high priority

**Meeting:** At 00:28:34 the meeting explicitly observed a failure when dragging a task between columns.

**Current:** The changelog and current board tests show substantial work for mouse, touch, keyboard, card opening, and a Move fallback. The code therefore appears improved, but the existing coverage is primarily component and request-shape coverage rather than a full server-backed acceptance path across permissions and stale data.

**Required outcome:** Keep Move as a first-class fallback, test mouse, long-press touch, keyboard, failed mutation rollback, slow mutation, and a task changing elsewhere while dragging. Do not mark the meeting defect closed until the real API path is covered.

### C4. The board can silently omit tasks beyond 200 — high priority

**Current:** `boardTasks` applies `LIMIT 200` and returns no total or truncation flag. The list view is paginated, but the default board can still present a partial board as complete.

**Required outcome:** Return counts and truncation metadata per audience, offer an immediate List view or “show all in list” action, and make the board's partial state explicit. Do not silently increase an unbounded query for a large tenant.

### C5. The List view performs an unnecessary board request — medium priority

**Current:** `TasksPage` always calls `useTaskBoard`, even when `view=list`, while `TaskList` separately calls the paginated list endpoint. The list therefore pays for an unused 200-row board payload.

**Required outcome:** Enable only the active view's data query, while preserving shared invalidation when a task changes.

### C6. Operations-file linking is not usable from task creation — high priority

**Meeting:** The operations manager discussion explicitly requested a picker for linking a task to a particular operations file.

**Current:** The API and schema support generic `entity_type` and `entity_id`, and the shared route map supports `dossier` links to `/operations/files/<id>`. `TaskDialog` does not expose an operations-file picker, so the user cannot perform the demonstrated workflow without another client or direct API data.

**Required outcome:** Add a searchable operations-file picker, show the selected file reference in cards, list rows, Today, notifications, and the detail panel, and retain a safe empty state for deleted or inaccessible records.

### C7. Parent tasks, child tasks, and checklist subtasks are not separated in the UI — high priority

**Meeting:** The requested workflow is a main file task assigned to an operations manager, followed by separately assigned tasks for customs, costing, and other work, with milestones and deadlines.

**Current:** The schema accepts `parent_task_id`, but the client task input and dialog do not expose it. The visible subtasks are checklist rows added inside the panel, and they have no assignee, status, or dependency semantics.

**Required outcome:** Keep checklist subtasks for small steps. Add separately assignable child tasks with their own status, due time, priority, notification, and audit history. Show parent, children, milestone progress, and safe navigation in both directions. Do not call a child task a subtask if it can be assigned and evaluated independently.

### C8. Watchers and manual task pings have backend routes but no usable UI — high priority

**Meeting:** At 00:37:04 the proposed workflow included a bell or ping action that notifies a person about a task.

**Current:** `task_watcher` and add/remove watcher endpoints exist. The detail panel only displays existing watchers; it does not add, remove, or manually notify them. Assignment notification and scheduled reminders exist, but they do not replace an explicit “ping this person” action.

**Required outcome:** Add recipient selection, a clear ping action, deduplication per recipient, notification preferences, audit evidence, and a deep link back to the task. Prevent unauthorized users from notifying arbitrary tenant users.

### C9. Subtask deadlines still lack the requested time precision — medium priority

**Meeting:** At 00:38:07 the need for times within a single day was explicit.

**Current:** Parent tasks use a datetime field, but TaskPanel uses a date-only field for a new or edited subtask deadline.

**Required outcome:** Use tenant-local date and time for child milestones as well as parent tasks. Display the exact time consistently in Today, Calendar, the list, and the detail panel.

### C10. Reminder values outside presets are not round-trip safe — medium priority

**Current:** Task and event dialogs load `reminder_minutes` into a select whose options are only presets. An existing custom value has no matching option and can be lost or changed on an unchanged save.

**Required outcome:** Either support custom reminder values explicitly or render an “Existing custom reminder” option and preserve it until the user changes it. Add task and event round-trip tests.

### C11. A repeating task without a due datetime never materializes — medium priority

**Current:** The task dialog allows a repeat rule even when no due datetime is supplied. The recurrence worker indexes recurring rows with a due anchor, so the apparently repeating task has no occurrence schedule.

**Required outcome:** Require an anchor datetime before enabling recurrence, or make the form explain and enforce a schedule before save. Keep yearly behavior and leap-day behavior covered by the existing recurrence tests.

### C12. Task UI does not expose all backend-supported relationships — medium priority

**Current:** Initial subtasks are accepted by the API but not entered in the create dialog. Parent references and operations-file links are also absent. There is no dependency graph, blocked-by state, or milestone roll-up.

**Required outcome:** Add a simple first version that supports parent/child task links and optional blocked-by relationships without turning checklist subtasks into a project-management system. Any dependency semantics must be explicit and auditable.

## D. Calendar bugs and gaps

### D1. Calendar date windows mix browser-local dates with tenant-time event instants — high priority

**Current:** `CalendarPage` builds `YYYY-MM-DD` bounds and `dates.ts` indexes event instants with browser-local `Date`. The backend event and deadline queries compare those bare dates directly, while writes normalize zoneless input on the tenant timezone. A browser in a different timezone can receive inconsistent windows or file an event under a neighboring day.

**Required outcome:** Define one range contract, preferably tenant-local date bounds converted server-side to an inclusive start and exclusive next-day end. Return or expose the tenant timezone for display and index dates in that same zone.

### D2. Month range construction overfetches and can exclude the intended final day — high priority

**Current:** The month view fetches from the first of the previous month to a date near the end of the next month, even though the visible six-week grid needs only its actual first and exclusive last day. The final bound is treated inconsistently with an exclusive-end query. This can overfetch and omit events or deadlines on the final intended day.

**Required outcome:** Use the exact visible-grid range with a documented exclusive end. Add tests for month boundaries, six-row months, multi-day events, and deadlines on the final visible day.

### D3. Deadline loading and failure are not surfaced independently — high priority

**Current:** Calendar renders an error only for the event query. Deadline loading follows the event loading flag, and a failed deadline request can look like a calendar with no task deadlines. The month agenda counts and displays events only, not deadlines.

**Required outcome:** Give events and deadlines independent loading and error states. Show deadlines in the agenda or provide a clear combined agenda count and retry state. Never silently remove a class of work because its secondary query failed.

### D4. Mobile month cells hide the controls that open existing records — high priority

**Current:** On small screens the month grid replaces event and deadline chips with non-interactive dots. Tapping the cell opens the new-event path, so an existing event or deadline can be visible only as an unreadable dot and cannot be selected from that view.

**Required outcome:** Make the mobile cell open a day agenda or bottom sheet containing the day's event and deadline rows. Preserve direct event and task selection. Do not force users to switch to week view to reach existing work.

### D5. The month grid has nested interactive semantics — high priority

**Current:** A calendar cell is a `div` with `role="button"` and keyboard handlers containing event and deadline buttons. This creates competing interactive regions and requires careful screen-reader and keyboard behavior.

**Required outcome:** Redesign the cell semantics so the day action and item actions are separate, valid, and predictable. Test keyboard focus order, Enter and Space behavior, escape from a day sheet, screen-reader labels, and mobile touch behavior.

### D6. Invited participants do not see events in their own calendar — high priority

**Current:** `listEvents` in “mine” mode filters only `created_by`, even though the schema has `calendar_participant`. A person invited to a meeting can miss it from Calendar and Today.

**Required outcome:** Include the creator and invited internal participants in personal event visibility, with a deliberate policy for declined events. Add participant-response filtering only after the base visibility rule is correct.

### D7. Calendar event authorization is incomplete for ID-based access — critical priority

**Current:** `getEvent`, update, delete, and participant operations resolve an event by ID without checking whether the caller created it, is a participant, is an organizer, or has an administrative permission. The list is narrower than the detail and mutation paths. A guessed or leaked ID can therefore access or mutate an event inconsistently with the list.

**Required outcome:** Implement one event authorization policy in the service and reuse it for list, get, update, delete, add/remove participant, and response. A participant may respond only for their own participant row. An organizer or explicitly authorized manager may edit invitations. Unauthorized records should resolve as not found where appropriate. Add security tests before exposing more event links.

### D8. Update clash detection is missing and the update `force` flag is ignored — high priority

**Current:** Create checks location clashes, but update does not repeat the check. `force` is accepted by update validation but is not used by `updateEvent`. Create clash detection also runs before the service normalizes zoneless input into tenant instants, so warning times can disagree with persisted times.

**Required outcome:** Normalize first, run the same clash policy on create and update, exclude the current event, and honor `force` only after showing the conflict. Test touching endpoints, multi-day events, timezone boundaries, and a changed location.

### D9. Participant invitation and response management is absent from the event dialog — high priority

**Meeting and code:** The screen registry advertises an invite-participant action and the backend has participant routes, validation, response states, and reminder recipients. The current event dialog sends no participants and has no attendee or response UI.

**Required outcome:** Add internal-user and external-attendee selection, attendee list, organizer indication, response status, add/remove controls, and notifications. Enforce that only permitted users manage invitations and that an invitee can respond to their own invitation.

### D10. Event start changes do not reliably update the default end — medium priority

**Current:** A new event initializes an end time immediately. When the user changes the start, the end is already non-empty, so the one-hour default is not recalculated. The form can silently keep an old end time or become invalid.

**Required outcome:** Track whether the end was user-edited. Recalculate the default end whenever the start changes until the user takes ownership of the end field, then validate and preserve the user's choice.

### D11. Calendar agenda and week view lose useful information — medium priority

**Current:** The month agenda filters by event start month, so an event that began in the previous month but overlaps the current month can appear in the grid but not the agenda. The week view lists event titles and locations without a visible start time. The agenda omits task and subtask deadlines entirely.

**Required outcome:** Build agenda rows from the same overlap set as the grid, include deadlines, and show the exact local start and end or all-day state in week rows.

### D12. Calendar linked-record support is not exposed — medium priority

**Current:** The event API and schema accept `entity_type` and `entity_id`, and the server derives a link, but the dialog does not let a user link an event to an operation file or another supported record.

**Required outcome:** Add a safe record picker or a deliberate first-release operations-file picker. Show the link in event detail, Today, Calendar, reminders, and notifications.

### D13. Event reminders can suppress all but one recipient — high priority

**Current:** The reminder worker correctly builds a set of organizer and participant recipients, but it passes the same dedupe key, `event-reminder:<event id>`, to every recipient. The notification service deduplicates globally for the key, so the first recipient can claim the key and later recipients can be skipped. Existing sweep tests use a fake notifier and therefore do not exercise the production dedupe behavior.

**Required outcome:** Scope the dedupe key per event and recipient, preserve one delivery per recipient, and add a production-shaped test with two internal participants plus the organizer.

### D14. Calendar has no explicit team/shared-calendar contract — medium priority

**Current:** The backend has an `audience=all` path for a tenant-wide caller, but the Calendar UI does not expose an audience switch and the event schema has no scope field for team calendars.

**Required outcome:** Do not imply a team calendar until its visibility and scope model are defined. Personal calendar should include owned and invited events. A shared calendar should require an explicit permission and a documented audience model.

# Improvements and additional features

These are not all bugs. They are the work needed to make the tab efficient and useful after the correctness issues above are resolved.

## Today improvements

- Add a quick capture action that can create a task with title, assignee, due date/time, and reminder without navigating away from Today.
- Add inline complete, postpone, reassign, and snooze actions for tasks, with confirmation only for destructive operations.
- Add an overdue carry-over section with a count and a one-click “move to today” or “reschedule” action.
- Make Today rows open the exact task, event, approval, notification, receipt, or source record.
- Show a clear freshness timestamp and refresh affordance for roll-ups that are intentionally cached.
- Preserve independent panel error states and show partial availability without replacing empty states with generic errors.
- Reuse one tenant-zone formatter for dates, times, day labels, and all-day records.

## Tasks improvements

- Add an operations-file picker and display the file reference consistently.
- Add parent/child operational tasks distinct from checklist subtasks.
- Add milestone progress, child-task status roll-up, and optional blocked-by relationships.
- Add watcher selection and a manual ping action with notification history.
- Add task comments or a lightweight activity thread only if the team needs discussion inside the work item; otherwise keep communication in Smart Comms and make the task link precise.
- Add saved filters for Mine, Team, All, overdue, unassigned, and linked operations file.
- Offer a compact list or table for large boards, with server-side search, sort, counts, and truncation state.
- Preserve task reminder values, allow custom lead times, and make recurrence require a valid anchor date and time.
- Add a keyboard-accessible quick action for status changes and assignment.

## Performance and workflow review feature

Meeting 4 explicitly requested a team-performance and burn-rate view, separate from Empower HR appraisals. The first version should be operational rather than disciplinary:

- workload by assignee and team;
- open work in progress;
- overdue and delayed tasks;
- on-time completion rate;
- cycle time by status;
- reopened or repeatedly rescheduled work;
- child-task and milestone completion;
- assignment balance and unassigned work;
- links from every chart to the underlying task list.

“Burn rate” must be defined before implementation. The guide recommends task throughput and WIP burn for the first release, not a financial cost calculation, unless the team explicitly wants a link to costing data. Automated employee queries should be treated as draft communication, not an HR sanction, and should respect the separate Empower permission model.

## Calendar improvements

- Add a mobile day agenda sheet from a month cell.
- Add an agenda mode that combines events and deadlines for the visible window.
- Add participant responses and organizer controls.
- Add a visible event time in week rows and a clear all-day treatment.
- Add event type filtering and search after the basic visibility contract is correct.
- Add a day or time-grid view only if the team needs hour-level scheduling beyond the current week agenda.
- Add external calendar synchronization only as a separately approved integration; it is not a direct Meeting 4 requirement.
- Make linked operation files and task records open from event detail and reminder notifications.

## Cross-surface efficiency and quality

- Use one canonical deep-link helper for tasks, events, approvals, notifications, receipts, and operation files.
- Use one workspace invalidation policy so a task or event change refreshes Today, Tasks, Calendar, and the selected detail without refetching unused views.
- Lazy-load only the active hub section, while prefetching the likely next view on deliberate navigation rather than on initial page load.
- Add loading, error, empty, stale, permission, and truncated states to every workspace query.
- Run an editorial pass on labels, punctuation, and explanatory text, including the full-stop issue raised at 00:43:32.
- Keep mobile navigation discoverable because the desktop ribbon is not present below the responsive breakpoint.

# Proposed acceptance contract

## Shared acceptance

- `/workspace`, `/workspace/today`, `/workspace/tasks`, and `/workspace/calendar` resolve to the same hub with one active section and no duplicate navigation row on desktop.
- The mobile fallback exposes all three sections and keeps the active section announced to assistive technology.
- Notification and reminder links open the correct section and record, including after a cold load.
- No workspace screen displays a successful empty state when its data request failed.
- All read and mutation endpoints apply the same authorization rule as the UI.
- Tenant timezone behavior is tested independently from the browser timezone.
- Existing task and event records with unsupported or deleted linked records remain readable and do not produce dead or crashing buttons.

## Today acceptance

- Approvals, alerts, receipts, recent activity, and the day timeline load independently.
- The user can distinguish empty, unavailable, stale, and truncated states.
- Open overdue work is visible without being mistaken for work due later.
- Invited events and actionable child deadlines follow the agreed visibility policy.
- A user can open the underlying approval, notification, receipt, task, event, or record from the roll-up.

## Tasks acceptance

- Mouse, touch, keyboard, and Move-menu status changes produce one consistent server-side transition.
- A task opened from Team or All remains readable and editable only according to the selected authorization policy.
- Operations-file linking, parent/child tasks, milestones, assignment, watchers, manual pings, reminders, and custom recurrence values round-trip without silent loss.
- A large board advertises truncation and provides a complete server-paged alternative.
- Performance charts are derived from the same authorized task set as the underlying drill-down list and do not expose more data than the viewer may see.

## Calendar acceptance

- Month, week, day-cell, agenda, Today, and reminder views agree on the same tenant-local date and event visibility.
- Event overlap is included in both grid and agenda regardless of the event's start month.
- Deadline failures are visible and independently retryable.
- Existing mobile event and deadline rows can be opened without creating a new event accidentally.
- Event authorization covers list, detail, edit, delete, invitation, response, and reminder recipients.
- Create and update clash checks use the same normalized instants and `force` behavior.
- Every internal participant receives one reminder and can respond according to the agreed policy.

# Test plan and evidence required in the three PRs

The current workspace tests cover API envelope behavior, repeat rules, task board gestures, task-page deep links, Today roll-ups, task visibility SQL, reminder sweeps, recurrence spawning, and tenant-time conversion. There are no comparable Calendar component tests for the mobile month selection, nested interaction semantics, event authorization, update clashes, participant UI, event reminder dedupe, or browser-versus-tenant timezone behavior.

The three PRs must add, at minimum:

- route and navigation tests for canonical section links, old notification links, refresh, browser back/forward, ribbon, mobile fallback, and query-state preservation;
- independent Today panel failure and truncation tests;
- approval visibility tests for direct user, role, open, module, and unauthorized rows;
- task detail tests with Mine, Team, and All audiences;
- a status-route audit and notification test from every status-changing UI path;
- server-backed drag failure and permission tests in addition to existing sensor tests;
- board truncation and list completeness tests;
- operations-file, parent-task, child-task, watcher, ping, custom reminder, and recurrence-anchor tests;
- Calendar date-window tests at month boundaries, tenant/browser timezone differences, multi-day events, and final exclusive-end dates;
- Calendar accessibility and mobile selection tests;
- event list/detail/mutation authorization tests;
- create and update clash tests, including force behavior and normalized times;
- participant invitation, response, reminder, and per-recipient dedupe tests;
- performance metric authorization tests that compare chart totals with authorized drill-down rows.

# Three-PR delivery plan

## PR 1 — My Workspace foundation, navigation, and Today trust

### Scope

- Canonical My Workspace section and deep-link contract.
- Ribbon, mobile fallback, screen registry, route aliases, and URL state.
- Permission-aware action visibility and shared workspace authorization helpers.
- Tenant-timezone contract for Today and Calendar reads.
- Today independent panel states, overdue carry-over, invited-event visibility, subtask deadline policy, row deep links, totals, and truncation indicators.
- Approval queue semantics for direct, role, module, and open assignments.
- Event list/detail authorization foundation, because Today and notifications cannot be trustworthy while event IDs bypass the list policy.
- Test and editorial pass for the new tab's labels, descriptions, and punctuation.

### Not in this PR

- New task hierarchy UI.
- Performance charts.
- Full Calendar participant UI and mobile grid redesign.

### Exit criteria

- A user entering through any supported workspace link reaches the intended section and record.
- Today remains useful when any one panel fails.
- “Awaiting me” and “Unread alerts” no longer confuse unavailable data with empty data.
- Overdue and invited work follow the agreed policy.
- No event can be viewed or changed solely because its identifier is known.
- Time and date acceptance tests pass for a tenant timezone different from the browser timezone.

## PR 2 — Tasks workflow, collaboration, and operational performance

### Scope

- Fix audience-aware task detail and mutation behavior.
- Route all status changes through the dedicated status transition service.
- Close the Kanban drag defect with real API, rollback, permission, and fallback coverage.
- Add board truncation metadata and avoid fetching the board when List is active.
- Add operations-file picker and linked-record presentation.
- Add parent/child operational tasks while retaining checklist subtasks as a separate concept.
- Add milestones, optional dependency semantics, and progress roll-up according to the approved model.
- Add watcher management and manual task pings.
- Preserve custom reminder values and require an anchor date/time for recurrence.
- Add subtask times and complete task/time formatting.
- Add the team performance and burn-rate view, either as a Tasks view or the agreed additional Workspace section, with authorized drill-downs.
- Keep performance review operational and separate from Empower HR appraisal records.

### Exit criteria

- A task listed in Team or All opens and mutates only when the server-authorized user may do so.
- Drag, Move, keyboard, and detail status changes have identical audit and notification behavior.
- No board hides more than the declared result set.
- A manager can link an operation file, create separately assigned child tasks, assign milestones, ping a person, and follow the resulting work from Today and Calendar.
- Custom reminders and daily, weekly, monthly, and yearly recurrence survive an edit without silent changes.
- Performance metrics reconcile with the authorized list and never become an HR appraisal by implication.

## PR 3 — Calendar collaboration, mobile usability, and final cross-surface polish

### Scope

- Exact tenant-local range construction and month/week indexing.
- Independent event/deadline loading and errors.
- Deadline rows in the agenda and exact times in week view.
- Mobile day agenda selection and accessible month-cell semantics.
- Event default-end behavior and normalized create/update clash checks.
- Participant invitation, response, organizer controls, and per-recipient notifications.
- Event visibility and mutation enforcement across all participant paths.
- Event linked-record picker and deep links.
- Reminder dedupe correction and production-shaped tests.
- Event type filter/search, quick event capture, and final Today–Tasks–Calendar consistency tests.
- Optional day/time-grid or external-calendar work only if the approved product decision places it inside this PR; neither is required to close the Meeting 4 core requirements.

### Exit criteria

- The grid, week view, agenda, Today, and reminders show the same event and deadline set for the same tenant-local window.
- Mobile users can open an existing event or deadline from the month experience.
- Keyboard and assistive-technology interaction does not confuse a day action with an item action.
- A meeting organizer can invite, edit, remove, and observe responses according to permission; an invitee can respond to their own invitation.
- A clash warning behaves identically on create and update.
- Each intended internal recipient receives one event reminder.

# Six decision questions

1. **Should the canonical deep-link format be path-based, such as `/workspace/tasks` and `/workspace/calendar`, with the selected record in the query, while `/workspace` remains the Today landing page; or should My Workspace instead adopt a query-based tab contract and make the hub consume `tab` explicitly?**

2. **Should all workspace dates and times be displayed and queried in the tenant workplace timezone, or should each viewer see their own browser or profile timezone, and how should all-day events be defined across that choice?**

3. **What is the approved visibility policy for tasks, events, and performance data: creator and assignee only, organigramme team scope, invited participants, tenant-wide viewers with a grant, or another combination, and which roles may edit or invite?**

4. **Should Today default to actionable open work plus overdue carry-over and invited events, with completed, cancelled, and historical subtasks behind an explicit filter, or should completed and cancelled items remain in the default daily timeline?**

5. **For the requested workflow, should separately assigned child work use the existing `parent_task_id` relationship while checklist subtasks remain lightweight, and should blocked-by dependencies and milestone roll-ups be part of the first Tasks release?**

6. **Should team performance be a fourth My Workspace section or a Tasks view, which operational metrics define “burn rate,” and should individual performance and automated employee queries be visible to all Workspace users or restricted to managers and the appropriate Empower or HR permissions?**

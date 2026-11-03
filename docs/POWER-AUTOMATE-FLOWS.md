# Power Automate + Outlook flows (design)

Status: **designed, not built or tested.** In this prototype notifications are only written to the Notification Log (`emailStatus = "LOGGED (prototype – not sent)"`). Setting **E-mail automation = Power Automate** in Audit & Configuration makes the app write rows with `emailStatus = QUEUED`.

## Pattern

The app (or its API) writes one **Notification Log** row per event, with recipient, CC, subject and a JSON `payload`. One Power Automate flow sends them:

1. Trigger: *When an item is created* in Notification Log, filtered to `emailStatus eq 'QUEUED'`.
2. Action: *Send an e-mail (V2)* from a shared mailbox. To = `recipient`, CC = `cc`, Subject = `subject`, Body = HTML from `payload`.
3. On success, update the row to `SENT` with the time. On failure, set `FAILED` and write `errorDetails`.

## Events

| Event | Rule | Recipient |
|---|---|---|
| Upcoming | 2 working days before planned end | FPR (+ backup CC) |
| Due today | planned end = today | FPR |
| Overdue | every day while overdue | FPR |
| Escalation | > 3 working days overdue (levels configurable: manager → department head → project owner) | Escalation recipient, FPR CC |
| Task completed | on completion | Project owner, approver CC |
| Task blocked | Start attempted while predecessors open | FPR |
| Task released | all predecessors complete | FPR |
| FPR changed | on reassignment | New FPR |
| Approval requested | on submit | Approver |
| Task rejected | on reject | FPR |
| Project completed | auto-closure | Project owner |

## Scheduled checks

The prototype runs `Notifier.runScheduledChecks()` on app load and from the Escalation Centre. In production, create a **Recurrence** flow (daily, working days) that queries open tasks and creates the reminder/overdue/escalation rows with the same dedupe keys.

## Duplicate prevention

Each row has `dedupeKey` (for example `OVERDUE:2026-11-03`, `UPCOMING_REMINDER:<plannedEnd>`, `ESCALATION:L1`). Skip creation when a row with the same `taskId + type + dedupeKey` exists.

## E-mail body fields

Project ID, Project Name, Brand, Task ID, Task Name, Department, Assigned FPR, Planned Start, Planned End, Actual Start, Delay Days, Blocking Predecessor, Required Action, Dashboard URL — all present in `payload`.

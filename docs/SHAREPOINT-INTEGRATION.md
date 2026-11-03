# SharePoint integration (production)

Status: **not configured.** `npd-tracker/js/core/adapters/sharePointAdapter.js` is a stub with the same interface as the browser-storage adapter (`load`, `save`, `clearAll`, `exportAll`, `importAll`).

## Lists

One SharePoint list per collection (names in `js/core/models.js`):

| List | Collection | Key columns |
|---|---|---|
| Project Master | `projects` | projectCode, name, brand, category, kind, ownerId, launchDate, priority, status, schedulingMode, anchorDate, actualStartDate, plannedEndDate, actualEndDate, closureHistory (JSON) |
| NPD Activity Master | `activityMaster` (+ `masterDependencies`) | activityNo, sequence, name, department, defaultFprId, expectedDuration, isMandatory, approvalRequired, isActive |
| Project Task Master | `projectTasks` | projectId, activityId, activityNo, name, department, fprId, backupFprId, approverId, escalationId, expectedDuration, status, approvalStatus, planned/forecast/actual dates, isMandatory, isActive |
| Task Dependency Master | `taskDependencies` | projectId, taskId, predecessorId, type (FS/SS/FF/SF), lagDays — **one row per predecessor, never a text list** |
| Stakeholder Master | `stakeholders` | employeeName, department, designation, email, managerId, backupFprId, role, isActive |
| Approval History | `approvalHistory` | taskId, projectId, action, by, note, timestamp — append-only |
| Working Calendar | `workingCalendar` | weekendDays, holidays |
| System Configuration | `systemConfig` | thresholds and data adapter |

Also: `auditLog`, `taskHistory`, `scheduleBaselines`, `templates`, `comments` (append-only or supporting lists). Add a unique constraint on Task ID per project.

## Required architecture

```
HTML dashboard → secure API (validates every write, checks role) → SharePoint Lists (Microsoft Graph)
```

- Authenticate with Microsoft Entra ID (MSAL). Derive roles from group membership.
- **Do not** put client secrets or tokens in browser JavaScript. Keep Graph credentials on the API.
- Re-validate permissions, dependency rules (cycles, duplicates, cross-project) and actual-date immutability **on the server**; the browser checks are for usability only.
- Concurrent edits: use the SharePoint ETag / item version in an `If-Match` header; the prototype already throws `ConflictError` when `expectedVersion` differs.
- Replace the prototype's whole-collection `save()` with per-record `POST` / `PATCH` before going live.

## Switching on

1. Build the API and lists above.
2. In **Audit & Configuration**, set Data adapter = SharePoint and the API base URL.
3. Provide `getToken` (MSAL) to `SharePointAdapter` in `js/app.js`.
4. Test with the acceptance matrix before announcing it as live.

# Testing report

Run on 2026-11-03.

- `node npd-tracker/tests/run-tests.mjs` — **11 / 11 pass** (calendar, dependency validation, scheduler, seed, lifecycle, permissions, master rules, task classification, persistence).
- `node npd-tracker/tests/browser-acceptance.cjs` (headless Chromium) — **7 / 7 pass**, no console errors.
- Smoke test: all 12 pages render without errors.

## The 30 acceptance scenarios

"Engine" = automated test of the logic; "Browser" = driven through the real UI.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1–2 | Create Project A (Brand A) and B (Brand B) | Pass | Engine; Browser (wizard) |
| 3 | Generate activities from the initial master | Pass | Engine: 30 tasks, 38 dependencies |
| 4 | Add new task "Artwork Final Approval" | Pass | Engine; Browser |
| 5 | Different FPR for it in A and B | Pass | Engine |
| 6–7 | Durations 4 and 7 working days | Pass | Engine |
| 8 | Predecessor = Vendor Proof Approval | Pass | Engine; Browser |
| 9–10 | Save both; one project does not affect the other | Pass | Engine |
| 11–13 | Second predecessor; change type; validation (duplicate, cycle, self, cross-project) | Pass | Engine |
| 14–15 | Remove predecessor; downstream dates recalculate | Pass | Engine |
| 16–17 | Change FPR (audit records previous and new FPR); e-mail recipient update | FPR change passes; e-mail **removed by request** | Engine |
| 18 | Audit history | Pass | Engine: before/after FPR, dependencies, dates |
| 19–20 | Start / complete capture dates automatically | Pass | Engine; Browser (Start) |
| 21 | Approval controls (submit, reject needs reason, approve) | Pass | Engine |
| 22–23 | Project start/end captured automatically; reopen preserves closure record | Pass | Engine |
| 24 | Blocked task behaviour | Pass | Engine |
| 25 | Reminder and escalation e-mails | Removed by request | Notifications, Power Automate and the automailer were taken out. The Escalation Centre still lists overdue / due / blocked / approval-pending tasks |
| 26 | Gantt updates | Partial | Renders correctly after changes (Browser screenshots). No automated assertion that bars move |
| 27 | Optional / Not Required tasks do not block closure | Pass | Engine |
| 28 | Data persists after refresh | Pass | Browser; Engine |
| 29 | Unauthorized users blocked | Pass | Engine; Browser (Management has no action buttons) |
| 30 | Simultaneous updates do not overwrite | Pass (version check) | Engine: a stale `expectedVersion` is rejected. Not tested with two live browser tabs |

## Not tested / not claimed

- SharePoint Lists connection — adapter is a stub.
- Entra ID sign-in — login is simulated.
- Gantt export and Excel import/export were not exercised automatically.

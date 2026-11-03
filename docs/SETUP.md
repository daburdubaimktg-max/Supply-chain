# Setup guide

## Requirements
A modern browser, and any static web server (Python 3 is enough). Chart.js and SheetJS load from cdnjs, so the first load needs internet access.

## Run
```bash
cd npd-tracker && python3 -m http.server 8123
```
Open <http://localhost:8123>.

## First use
1. The initial baseline loads automatically: 30 activities, 38 default dependencies, 17 stakeholders, working calendar (Sat+Sun off), and 2 **SAMPLE** projects.
2. Pick a user in **Signed in as**. Administrator can do everything; FPR sees and acts on assigned tasks; Management is read-only.
3. **+ New Project** → fill in details → tick which activities apply, set FPRs and durations → the schedule and Gantt are generated.
4. Edit anything without touching code:
   - *Activity Master*: add / edit / deactivate activities and default dependencies.
   - *Project Task Config*: per-project tasks, FPR dropdowns, durations, mandatory/optional, approvals, **Not required**.
   - *Dependencies*: add / remove / change predecessors, type and lag, with impact preview.
   - *FPR & Stakeholders*: people, e-mails, managers, backup FPRs.
5. Delete the samples from **Audit & Configuration → Delete SAMPLE projects**.

## Not Required tasks
Open a task → **Not Required** (reason needed), or use the button in Project Task Config. The task drops out of the schedule and Gantt, its dependants are released, and it no longer blocks project closure. **Restore as Required** reverses it.

## Excel
Export buttons appear on Tasks, Gantt, Portfolio, Activity Master and Stakeholders. Imports show a validated preview and write nothing until you confirm. Predecessors are written as `4, 9, 14` (optionally `9FF+1` for type and lag).

## Reset
**Audit & Configuration → Reset to initial baseline** clears this browser's data. **Backup all data** downloads JSON first.

## Going to production
See `SHAREPOINT-INTEGRATION.md` and `POWER-AUTOMATE-FLOWS.md`.

# NPD Gate Tracker

> **New: `gantt-dashboard.html`** is a dashboard and editable Gantt built only from `Gant_Chart_Updated.xlsx` (see [Transition Gantt Dashboard](#transition-gantt-dashboard-gantt-dashboardhtml) below).

A project management tool for New Product Development (NPD) across functions: Marketing, R&D, Packaging, Supply Chain, Regulatory, Quality, Manufacturing, Finance and Sales. It tracks many brands, with many projects per brand, through stage gates up to the **FPR (First Production Run)** and launch.

It is a single file, `index.html`. There is nothing to install: open it in Chrome or Edge. Data is saved in your browser, and the **Excel workbook is the master data**. Keep that workbook in OneDrive.

## What's inside

| View | What it shows |
|---|---|
| **Portfolio** | All brands and their projects: launch roadmap, current stage, next gate, FPR date, forecast vs target launch, health. Brand list with managers. |
| **Project dashboard** | Progress, FPR date and slip vs baseline, launch buffer, stage-gate pipeline, FPR readiness, workload by function, delayed tasks. |
| **Gantt** | Timeline by stage or by function. Day/week/month zoom, dependency arrows, critical path, baseline bars, gate diamonds, and Today / FPR / Target lines. |
| **Tasks** | Task register with predecessors, dates, slack, variance and status. Click a row to edit. |
| **Functions** | One board per function with its tasks, progress and delays. |
| **Stage gates** | Gate criteria checklists and Go / Hold / Recycle / Kill decisions. |
| **Escalations** | Escalation matrix metrics (by level, function and brand), open escalations with recipients, matrix rules, and the People directory (SPOC → boss). |
| **Project setup** | Brand, code, dates, working week, holidays, functions, stage names, baseline. |

### Scheduling: dependent and independent tasks
- **Dependent** tasks are scheduled from their predecessors. Links can be `5` (finish-to-start), `5SS+2`, `7FF-1` or `3SF`, with lags in working days. With *strict stage-gate* on, a dependent task also waits for the previous gate.
- **Independent** tasks run on a fixed start date, like licence filings or parallel studies. Other tasks can still depend on them.
- Changing any duration or link re-plans everything downstream. The app then tells you how far the FPR and launch moved.
- Working week can be 5, 6 or 7 days, and plant holidays are skipped.

## Excel master data (in OneDrive)

One workbook holds the whole portfolio. Every sheet links to its project through **Project Code**.

| Sheet | Columns |
|---|---|
| Brands | Brand, Category, Brand Manager, Manager Email |
| Projects | Project Code, Brand, Project Name, Category, SKU, Kick-off Date, Target Launch, Work Week, Strict Gates, FPR Task ID, Launch Task ID, Holidays |
| Functions | Function, Colour, Function Head, Head Email |
| People | SPOC Name, Email, Function, Reports To, Reports To Email |
| Stages | Project Code, Stage No, Stage Name, Gate Name, Gate Decision, Decision Date, Gate Notes |
| Gate Criteria | Project Code, Stage No, Criterion, Met (Y/N) |
| Tasks | Project Code, ID, Task, Function, Stage No, Owner, Owner Email, Type, Scheduling, Predecessors, Duration (days), Fixed Start, Progress %, FPR Critical, Notes |
| Escalation Matrix | L1/L2/L3 day thresholds, reply days, NPD head and email, signature |

On export the app adds calculated columns (planned dates, slack, status, variance) and an **Escalations** sheet. Import ignores both.

- `templates/NPD_Master_Data_Template.xlsx`: an empty template with the standard 30-task FMCG plan. Start here.
- `templates/NPD_Sample_Portfolio.xlsx`: the sample portfolio (3 brands, 4 projects) filled in.

**Workflow with OneDrive**
1. Save the master workbook in a OneDrive folder, for example `OneDrive - Company\NPD\NPD_Master_Data.xlsx`. Teams update their rows there.
2. In the app, use **Import Excel** and pick that file. Projects with an existing code are updated and keep their baseline. New codes are added.
3. After editing in the app, use **Export Excel** and save the file over the one in OneDrive. Browsers save to Downloads by default; turn on *Ask where to save each file* to save straight into OneDrive.

## Escalation matrix

Escalation levels and rules are shown in the app. **Escalations → Compose in Outlook** opens a pre-filled e-mail draft for one escalation; you review and send it yourself. There is no automatic mailer.

---

## Transition Gantt Dashboard (`gantt-dashboard.html`)

A separate dashboard built only from what is in `templates/Gant_Chart_Updated.xlsx` (Settings + Gantt sheets). Open the file in Chrome or Edge; it loads with that workbook's data.

**Views**
- **Dashboard.** Project details (title, PM, priority, NPPF, brief, timespan, duration, *Updates on*), overall %, overdue items as of *Updates on*, ⚠ issues, next milestone, end vs base plan, workstream timelines, milestone track, department and team-member load, needs-attention list.
- **Gantt.** The same columns as the sheet (#, Description, Role, Team Member, ⚠, Ind Start/End, d. Id, Conn, Lag, Work Days, Start, End, %) on a Mon–Fri timeline. It has the four *Color* modes (Project Structure, Team Roles, Issues, Default), base-plan bars, dependency links and the *Updates on* line.
- **Settings.** Project details, departments with codes, team members with roles, base plan, and the admin PIN.

**Dates are calculated exactly like the workbook.** Ind Start wins, then Ind End, then the d. Id link (FS/SS/FF/SF + lag) with `WORKDAY`/`NETWORKDAYS`. Rows linked to Settings dates (Product Brief, NPPF, Project Start) move when those dates change. Stages summarise every row beneath them.

**Admin-only editing**
- Everyone sees a read-only dashboard. **Admin sign in** (default PIN `admin`; change it under Settings → Admin access) turns on editing.
- On the Gantt, admins drag a bar to set a new start, drag the bar's right edge to change work days, or click a row to edit any field, insert, delete or move rows. Every change re-plans the linked rows and offers **Undo**.
- The PIN is a soft lock inside the page. For hard access control, give only admins edit rights to the OneDrive/SharePoint workbook.

**Excel / OneDrive.** *Import Excel* (admin) reads a workbook in the `Gant_Chart_Updated.xlsx` layout from your OneDrive folder. *Export Excel* writes the same Settings and Gantt layout back, with calculated dates as values, Settings-date and d. Id links kept as formulas, and the admin PIN hash included.

**Note on the source file.** In the Gantt sheet the *Procurement* stage formulas (`K49 =MIN(S50:S52)`, `R49 …MAX(T50:T52)`) stop one row short and miss *Material Delivered* (row 53), so Excel shows the stage ending 29-Apr-26. The dashboard includes that row and shows 30-Apr-26.

---

## NPD & Transition Management Tracker (`npd-tracker/`)

A fully editable New Product Development (NPD) & Transition management system for an FMCG business, built from the master prompt in `Create_NPD_Tracker_Command.pdf`. It replaces the manual Excel tracker and Gantt chart with an HTML dashboard.

**Status: working prototype.** Data persists in the browser. SharePoint Lists is designed and stubbed, but **not connected or tested** (see below). There is no e-mail or notification feature.

### Run it

ES modules need HTTP (not `file://`):

```bash
cd npd-tracker && python3 -m http.server 8123
```

Open <http://localhost:8123>. On first load the app seeds the 30-activity master, dependency matrix, stakeholders and two clearly labelled **SAMPLE** projects. Use the **Signed in as** picker (top right) to switch between Administrator, Department Head, FPR and Management roles.

### What is built

- **Fully editable, nothing hardcoded.** The 30 activities, dependencies, FPRs, durations, departments, approvals and mandatory/optional flags are database records edited through the dashboard.
- **Not Required tasks.** Any task can be marked *Not Required* for a project (with a reason). It is skipped in the schedule and Gantt, its dependants are released, and it never blocks project closure. It can be restored.
- **Independent projects.** Each project gets its own copy of tasks, FPRs, durations and dependencies. Master changes never alter existing projects unless an admin previews and confirms "Apply to existing projects".
- **Multiple predecessors**, FS/SS/FF/SF with lag, one row per relationship, with validation (cycle, self, duplicate, missing, inactive, cross-project) and a schedule-impact preview before saving.
- **Scheduling engine.** Working-day calendar (weekends, public/company holidays), forward and backward scheduling, planned / forecast / actual dates, critical path, downstream recalculation.
- **Task actions** with automatic date + user capture: Start, Submit for Approval, Approve, Reject (reason required), Complete, Reopen (reason required), History. Project actual start/end are captured automatically.
- **12 pages:** Executive Overview, Project Portfolio, Gantt, Task Management, Activity Master, Project Task Config, Dependencies, FPR & Stakeholders, Performance Analytics, Escalation Centre (read-only list of overdue / due / blocked / approval-pending tasks), Project Details, Audit & Configuration.
- **Excel** import (validated, previewed, confirmed) and export; JSON backup/restore.
- **Roles** enforced in both the UI and the data layer.

### Prototype vs production

| Area | In this build | Needed for production |
|---|---|---|
| Database | Browser `localStorage` via an adapter | Configure `SharePointAdapter` + secure API — `docs/SHAREPOINT-INTEGRATION.md` |
| Login | Simulated user picker | Microsoft Entra ID; server-side permission checks |
| Concurrency | Version check on every update (conflict error) | Same, enforced server-side |

The app shows this limit in a banner and in the sidebar. Live SharePoint is **not** claimed to be operational.

### Tests

```bash
node npd-tracker/tests/run-tests.mjs          # 11 engine tests
node npd-tracker/tests/browser-acceptance.cjs # UI test (needs the server running)
```

See `docs/TESTING-REPORT.md` for the 30-scenario matrix.

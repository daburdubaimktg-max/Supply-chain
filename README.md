# NPD Gate Tracker

A project management tool for New Product Development (NPD) across functions: Marketing, R&D, Packaging, Supply Chain, Regulatory, Quality, Manufacturing, Finance and Sales. It tracks many brands, with many projects per brand, through stage gates up to the **FPR (First Production Run)** and launch. It also emails escalations through Outlook.

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

## Escalation matrix and Outlook automailer

| Level | Trigger (defaults, configurable) | To | Cc |
|---|---|---|---|
| L1 | Task pending **more than 3 days** past its planned finish | SPOC (task owner) | SPOC's boss |
| L2 | More than 7 days, any late critical-path task, or a gate decision overdue | SPOC's boss (gates: brand manager) | SPOC, function head |
| L3 | More than 14 days, a late FPR-critical task, a late FPR or launch milestone, or forecast launch past target | Brand manager | NPD head, boss, SPOC |

Each SPOC's boss comes from the **People** sheet. The SPOC name must match the task's Owner.

In the app, **Escalations → Compose in Outlook** opens a pre-filled email for one escalation.

For automatic daily emails, use `automailer/npd_automailer.py`. It reads the workbook straight from your OneDrive folder, works out escalations using the same rules as the app, and sends through Outlook desktop.

### Set up (Windows PC with Outlook and the OneDrive app)
1. Install Python 3.10+ and run:

   ```bash
   pip install -r automailer/requirements.txt
   ```

2. Edit `automailer/config.ini` and set `workbook` to the file in your OneDrive folder.
3. Check what would be sent (nothing goes out; it writes `escalation_preview.html`):

   ```bash
   python automailer/npd_automailer.py --preview
   ```

4. Test safely. Set `test_recipient = your.name@company.com` and `mode = draft` (the emails land in your Outlook Drafts), then `mode = send`.
5. Go live. Clear `test_recipient` and keep `mode = send`.
6. Schedule it. In **Task Scheduler → Create Basic Task**, choose Daily at 09:00 and *Start a program* `automailer\run_daily.bat`. Outlook must be signed in on that PC.

The mailer keeps `NPD_Automailer_Log.csv` next to the workbook in OneDrive. An escalation is repeated every `repeat_every_days` (default 2). A move up to a new level is mailed straight away.

If no PC can run it, `mode = smtp` sends through Office 365 SMTP instead. Set `smtp_user` in the config and the password in the `NPD_SMTP_PASSWORD` environment variable. Your IT team may need to allow SMTP AUTH for that mailbox.

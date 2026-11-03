"""
NPD Gate Tracker - Outlook automailer.

Reads the NPD master data workbook (kept in a OneDrive folder), works out
which tasks are pending past their planned finish, and emails the SPOC with
their boss in copy, escalating up the matrix as the delay grows:

  L1  pending more than 3 days   -> To SPOC,            Cc SPOC's boss
  L2  more than 7 days, or a late critical-path task
                                 -> To boss,            Cc SPOC, function head
  L3  more than 14 days, late FPR-critical task, late FPR / launch milestone,
      or forecast launch past target
                                 -> To brand manager,   Cc NPD head, boss, SPOC

Thresholds, the NPD head and the signature come from the workbook's
"Escalation Matrix" sheet, so the app and the mailer always agree.

Run it daily with Windows Task Scheduler (see README). Typical use:

  python npd_automailer.py --preview          # write emails to an HTML file, send nothing
  python npd_automailer.py --mode draft       # put drafts in your Outlook Drafts folder
  python npd_automailer.py --mode send        # send through Outlook desktop
"""
from __future__ import annotations

import argparse
import configparser
import csv
import datetime as dt
import html
import os
import re
import smtplib
import sys
from collections import defaultdict, deque
from email.message import EmailMessage
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is missing. Install it with:  pip install openpyxl")

HERE = Path(__file__).resolve().parent
DEP_TYPES = {"FS", "SS", "FF", "SF"}
DEFAULT_MATRIX = {"l1": 3, "l2": 7, "l3": 14, "reply_days": 2,
                  "npd_head": "NPD Head", "npd_head_email": "", "signature": "NPD Gate Tracker"}


# --------------------------------------------------------------------------- helpers
def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def text(v) -> str:
    return "" if v is None else str(v).strip()


def yes(v) -> bool:
    return text(v).lower() in {"y", "yes", "true", "1"}


def to_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, (int, float)):
        return dt.date(1899, 12, 30) + dt.timedelta(days=int(v))
    s = text(v)
    for f in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d %b %Y", "%d %b %y"):
        try:
            return dt.datetime.strptime(s[:10] if f == "%Y-%m-%d" else s, f).date()
        except ValueError:
            pass
    return None


def fmt(d) -> str:
    return d.strftime("%d %b %y") if d else "-"


def read_sheet(wb, name):
    """Return the sheet as a list of dicts keyed by normalised header."""
    ws = next((wb[s] for s in wb.sheetnames if norm(s) == norm(name)), None)
    if ws is None:
        return None
    rows = ws.iter_rows(values_only=True)
    try:
        head = [norm(h) for h in next(rows)]
    except StopIteration:
        return []
    out = []
    for r in rows:
        if r is None or all(c in (None, "") for c in r):
            continue
        out.append({h: r[i] if i < len(r) else None for i, h in enumerate(head) if h})
    return out


def g(row, *names):
    for n in names:
        v = row.get(norm(n))
        if v not in (None, ""):
            return v
    return None


def parse_deps(s, self_id, ids):
    out = []
    for part in re.split(r"[,;]+", text(s)):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"#?(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?\s*d?", part, re.I)
        if not m:
            continue
        i = int(m.group(1))
        if i == self_id or i not in ids:
            continue
        out.append((i, (m.group(2) or "FS").upper(), int(m.group(3).replace(" ", "")) if m.group(3) else 0))
    return out


# --------------------------------------------------------------------------- calendar + scheduler
class Calendar:
    """Working-day calendar matching the web app (5, 6 or 7 day week plus holidays)."""

    def __init__(self, start, workweek=6, holidays=()):
        self.ww = workweek if workweek in (5, 6, 7) else 6
        self.hol = set(holidays)
        d = start
        while not self.is_work(d):
            d += dt.timedelta(days=1)
        self.days = [d]

    def is_work(self, d):
        if d in self.hol:
            return False
        wd = d.weekday()  # Mon=0 .. Sun=6
        return self.ww == 7 or (wd != 6 if self.ww == 6 else wd < 5)

    def _ext(self, n):
        while len(self.days) <= n:
            d = self.days[-1] + dt.timedelta(days=1)
            while not self.is_work(d):
                d += dt.timedelta(days=1)
            self.days.append(d)

    def wd2d(self, i):
        i = max(0, int(i))
        self._ext(i)
        return self.days[i]

    def d2wd(self, d):
        if d is None or d <= self.days[0]:
            return 0
        while self.days[-1] < d:
            self._ext(len(self.days) + 60)
        lo, hi = 0, len(self.days) - 1
        while lo < hi:
            m = (lo + hi) // 2
            if self.days[m] >= d:
                hi = m
            else:
                lo = m + 1
        return lo


def schedule(p):
    """Forward / backward pass over tasks and gates. Mirrors schedule() in index.html."""
    cal = Calendar(p["start"], p["workweek"], p["holidays"])
    ns = len(p["stages"])
    nodes = {}
    for t in p["tasks"]:
        nodes["t%d" % t["id"]] = {"task": t, "dur": 0 if t["milestone"] else max(0, t["dur"]), "preds": [], "succs": []}
    for k in range(1, ns + 1):
        nodes["g%d" % k] = {"task": None, "dur": 0, "preds": [], "succs": []}

    def link(a, b, typ, lag):
        A, B = nodes.get(a), nodes.get(b)
        if A is None or B is None or A is B:
            return
        B["preds"].append((A, typ, lag))
        A["succs"].append((B, typ, lag))

    for t in p["tasks"]:
        if t["independent"]:
            continue
        for (i, typ, lag) in t["deps"]:
            link("t%d" % i, "t%d" % t["id"], typ, lag)
        if p["strict_gates"] and t["stage"] > 1:
            link("g%d" % (t["stage"] - 1), "t%d" % t["id"], "FS", 0)
    for k in range(1, ns + 1):
        for t in p["tasks"]:
            if t["stage"] == k:
                link("t%d" % t["id"], "g%d" % k, "FS", 0)
        if k > 1:
            link("g%d" % (k - 1), "g%d" % k, "FS", 0)

    indeg = {id(n): len(n["preds"]) for n in nodes.values()}
    q = deque(n for n in nodes.values() if not n["preds"])
    order = []
    while q:
        n = q.popleft()
        order.append(n)
        for (s, _, _) in n["succs"]:
            indeg[id(s)] -= 1
            if indeg[id(s)] == 0:
                q.append(s)
    seen = {id(n) for n in order}
    order += [n for n in nodes.values() if id(n) not in seen]

    for n in order:
        es = 0
        t = n["task"]
        if t and t["independent"]:
            es = cal.d2wd(t["fixed"] or p["start"])
        for (a, typ, lag) in n["preds"]:
            if "es" not in a:
                continue
            v = {"SS": a["es"] + lag, "FF": a["ef"] + lag - n["dur"], "SF": a["es"] + lag - n["dur"]}.get(typ, a["ef"] + lag)
            es = max(es, v)
        n["es"] = max(0, es)
        n["ef"] = n["es"] + n["dur"]

    end = max((n["ef"] for n in nodes.values()), default=0)
    for n in reversed(order):
        lf = end
        for (s, typ, lag) in n["succs"]:
            if "lf" not in s:
                continue
            v = {"SS": s["ls"] - lag + n["dur"], "FF": s["lf"] - lag, "SF": s["lf"] - lag + n["dur"]}.get(typ, s["ls"] - lag)
            lf = min(lf, v)
        n["lf"], n["ls"] = lf, lf - n["dur"]
        n["slack"] = n["ls"] - n["es"]

    res = {}
    for t in p["tasks"]:
        n = nodes["t%d" % t["id"]]
        start = cal.wd2d(n["es"])
        finish = cal.wd2d(n["ef"] - 1) if n["dur"] > 0 else start
        res[t["id"]] = {"start": start, "finish": finish, "slack": n["slack"], "crit": n["slack"] <= 0}
    gates = []
    for k in range(1, ns + 1):
        n = nodes["g%d" % k]
        gates.append(cal.wd2d(n["es"] - 1) if n["es"] > 0 else cal.wd2d(0))
    return res, gates


# --------------------------------------------------------------------------- workbook
def load_workbook_data(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    tasks_rows = read_sheet(wb, "Tasks")
    if tasks_rows is None:
        sys.exit(f'"{path}" has no Tasks sheet. Export it from the NPD Gate Tracker or use the template.')

    brands = {}
    for r in read_sheet(wb, "Brands") or []:
        n = text(g(r, "Brand"))
        if n:
            brands[n] = {"name": n, "manager": text(g(r, "Brand Manager", "Manager")), "email": text(g(r, "Manager Email", "Email"))}

    functions = {}
    for r in read_sheet(wb, "Functions") or []:
        n = text(g(r, "Function"))
        if n:
            functions[n] = {"name": n, "head": text(g(r, "Function Head", "Head")), "email": text(g(r, "Head Email", "Email"))}

    people = {}
    for r in read_sheet(wb, "People") or []:
        n = text(g(r, "SPOC Name", "Name"))
        if n:
            people[n.lower()] = {"name": n, "email": text(g(r, "Email")), "boss": text(g(r, "Reports To", "Boss")),
                                 "boss_email": text(g(r, "Reports To Email", "Boss Email"))}

    matrix = dict(DEFAULT_MATRIX)
    keymap = {"l1dayslate": "l1", "l2dayslate": "l2", "l3dayslate": "l3", "replydays": "reply_days",
              "npdhead": "npd_head", "npdheademail": "npd_head_email", "signature": "signature"}
    for r in read_sheet(wb, "Escalation Matrix") or []:
        k = keymap.get(norm(g(r, "Setting")))
        v = g(r, "Value")
        if k and v not in (None, ""):
            matrix[k] = int(float(v)) if k in ("l1", "l2", "l3", "reply_days") else text(v)

    stage_rows = read_sheet(wb, "Stages") or []
    proj_rows = [r for r in (read_sheet(wb, "Projects") or []) if g(r, "Project Name", "Project")]
    if not proj_rows:
        proj_rows = [{"projectcode": "P-001", "projectname": "NPD project", "brand": "Unassigned"}]
    first_code = text(g(proj_rows[0], "Project Code", "Code")) or "P-001"

    projects = []
    for pr in proj_rows:
        code = text(g(pr, "Project Code", "Code")) or first_code
        mine = lambda r: (text(g(r, "Project Code", "Code")) or first_code) == code  # noqa: E731
        stages = sorted([r for r in stage_rows if mine(r) and g(r, "Stage Name")], key=lambda r: int(float(g(r, "Stage No") or 0)))
        stages = [{"name": text(g(r, "Stage Name")), "gate": text(g(r, "Gate Name")) or "Gate",
                   "decision": (text(g(r, "Gate Decision", "Decision")) or "Pending").capitalize()} for r in stages]
        if not stages:
            stages = [{"name": n, "gate": gt, "decision": "Pending"} for n, gt in (
                ("Discovery", "Idea screen"), ("Concept & Feasibility", "Business case approval"), ("Development", "Development sign-off"),
                ("Validation & Scale-up", "FPR & launch readiness"), ("Launch", "Post-launch review"))]
        raw = [r for r in tasks_rows if mine(r) and g(r, "Task", "Task Name")]
        ids, nxt = [], 1 + max([int(float(g(r, "ID", "Task ID") or 0)) for r in raw] + [0])
        for r in raw:
            i = int(float(g(r, "ID", "Task ID") or 0))
            if not i:
                i, nxt = nxt, nxt + 1
            ids.append(i)
        idset = set(ids)
        start = to_date(g(pr, "Kick-off Date", "Start Date")) or dt.date.today()
        tasks = []
        for r, i in zip(raw, ids):
            pv = text(g(r, "Progress %", "Progress"))
            try:
                pn = float(pv.replace("%", "")) if pv else 0.0
            except ValueError:
                pn = 0.0
            if "%" not in pv and 0 < pn <= 1:
                pn *= 100
            independent = text(g(r, "Scheduling", "Mode")).lower().startswith("ind")
            tasks.append({
                "id": i, "name": text(g(r, "Task", "Task Name")), "fn": text(g(r, "Function")),
                "stage": max(1, min(len(stages), int(float(g(r, "Stage No", "Stage") or 1)))),
                "owner": text(g(r, "Owner")), "owner_email": text(g(r, "Owner Email")),
                "milestone": text(g(r, "Type")).lower().startswith("mile"), "independent": independent,
                "deps": [] if independent else parse_deps(g(r, "Predecessors", "Dependencies"), i, idset),
                "fixed": to_date(g(r, "Fixed Start", "Start Date")), "dur": int(float(g(r, "Duration (days)", "Duration") or 0)),
                "progress": max(0, min(100, round(pn))), "fpr": yes(g(r, "FPR Critical", "FPR")),
            })

        def pick_id(v, pattern, need_ms=False):
            try:
                v = int(float(v))
                if v in idset:
                    return v
            except (TypeError, ValueError):
                pass
            for t in tasks:
                if re.search(pattern, t["name"], re.I) and (t["milestone"] or not need_ms):
                    return t["id"]
            return None

        ww = g(pr, "Work Week")
        projects.append({
            "code": code, "name": text(g(pr, "Project Name", "Project")), "brand": text(g(pr, "Brand")) or "Unassigned",
            "start": start, "target": to_date(g(pr, "Target Launch")), "workweek": int(float(ww)) if ww else 6,
            "strict_gates": True if g(pr, "Strict Gates") in (None, "") else yes(g(pr, "Strict Gates")),
            "holidays": [d for d in (to_date(x.strip()) for x in re.split(r"[,;]+", text(g(pr, "Holidays")))) if d],
            "fpr_id": pick_id(g(pr, "FPR Task ID"), r"fpr|first production"),
            "launch_id": pick_id(g(pr, "Launch Task ID"), r"launch", need_ms=True),
            "stages": stages, "tasks": tasks,
        })
    return projects, brands, functions, people, matrix


# --------------------------------------------------------------------------- escalations
def contact(name, email):
    return {"n": name or "", "e": email or ""}


def recipients(level, spoc, boss, fn_head, brand_mgr, npd_head):
    if spoc is None:  # gate / launch items: no SPOC
        to, cc = ([brand_mgr, npd_head], []) if level >= 3 else ([brand_mgr], [npd_head])
    else:
        if not (boss["n"] or boss["e"]):
            boss = fn_head
        if level == 1:
            to, cc = [spoc], [boss]
        elif level == 2:
            to, cc = [boss], [spoc, fn_head]
        else:
            to, cc = [brand_mgr], [npd_head, boss, spoc]
    ok = lambda x: x and (x["e"] or x["n"])  # noqa: E731
    key = lambda x: (x["e"] or x["n"]).lower()  # noqa: E731
    to, cc = [x for x in to if ok(x)], [x for x in cc if ok(x)]
    if not any(x["e"] for x in to):
        for i, x in enumerate(cc):
            if x["e"]:
                to.append(cc.pop(i))
                break
    uniq = lambda xs: [x for i, x in enumerate(xs) if all(key(y) != key(x) for y in xs[:i])]  # noqa: E731
    to = uniq(to)
    cc = [x for x in uniq(cc) if all(key(y) != key(x) for y in to)]
    return to, cc


def find_escalations(projects, brands, functions, people, M, today):
    out = []
    npd_head = contact(M["npd_head"], M["npd_head_email"])
    for p in projects:
        if any(s["decision"] == "Kill" for s in p["stages"]):
            continue
        res, gates = schedule(p)
        b = brands.get(p["brand"], {"name": p["brand"], "manager": "", "email": ""})
        brand_mgr = contact(b.get("manager") or f'{p["brand"]} brand manager', b.get("email"))
        fpr = res[p["fpr_id"]]["start"] if p["fpr_id"] in res else None
        launch = res[p["launch_id"]]["start"] if p["launch_id"] in res else None
        ctx = {"fpr": fpr, "launch": launch}
        for t in p["tasks"]:
            if t["progress"] >= 100:
                continue
            r = res[t["id"]]
            late = (today - r["finish"]).days
            if late <= M["l1"]:
                continue
            lvl = 3 if late > M["l3"] else 2 if (late > M["l2"] or r["crit"]) else 1
            if t["id"] in (p["fpr_id"], p["launch_id"]) or (t["fpr"] and late > M["l2"]):
                lvl = 3
            me = people.get(t["owner"].lower(), {})
            boss_rec = people.get(me.get("boss", "").lower(), {})
            spoc = contact(t["owner"], t["owner_email"] or me.get("email"))
            boss = contact(me.get("boss"), me.get("boss_email") or boss_rec.get("email"))
            f = functions.get(t["fn"], {})
            fn_head = contact(f.get("head") or (t["fn"] + " head" if t["fn"] else ""), f.get("email"))
            to, cc = recipients(lvl, spoc, boss, fn_head, brand_mgr, npd_head)
            out.append({"key": f'{p["code"]}|Task|{t["id"]}', "level": lvl, "kind": "Task", "p": p, "item": f'#{t["id"]} {t["name"]}',
                        "fn": t["fn"], "spoc": spoc, "boss": boss, "late": late, "due": r["finish"], "crit": r["crit"],
                        "progress": t["progress"], "to": to, "cc": cc, **ctx})
        for i, gd in enumerate(gates):
            st = p["stages"][i]
            late = (today - gd).days
            if st["decision"] != "Pending" or late <= M["l1"]:
                continue
            lvl = 3 if late > M["l3"] else 2
            to, cc = recipients(lvl, None, None, None, brand_mgr, npd_head)
            out.append({"key": f'{p["code"]}|Gate|{i + 1}', "level": lvl, "kind": "Gate", "p": p, "item": f'G{i + 1} {st["gate"]}: decision overdue',
                        "fn": "Gate review", "spoc": None, "boss": None, "late": late, "due": gd, "to": to, "cc": cc, **ctx})
        if p["target"] and launch and launch > p["target"]:
            late = (launch - p["target"]).days
            to, cc = recipients(3, None, None, None, brand_mgr, npd_head)
            out.append({"key": f'{p["code"]}|Launch', "level": 3, "kind": "Launch", "p": p,
                        "item": f"Forecast launch {fmt(launch)} is {late} days past target", "fn": "Programme",
                        "spoc": None, "boss": None, "late": late, "due": p["target"], "to": to, "cc": cc, **ctx})
    out.sort(key=lambda x: (-x["level"], -x["late"]))
    return out


def compose(x, M, today):
    p = x["p"]
    subject = f'[NPD L{x["level"]} escalation] {p["code"]} {p["name"]}: {x["item"]}' + (f' ({x["late"]} days late)' if x["kind"] == "Task" else "")
    who = ", ".join(c["n"] or c["e"] for c in x["to"])
    lines = [f"Hello {who},", "", f'This is a Level {x["level"]} escalation from the NPD Gate Tracker.', "",
             f'Brand / project: {p["brand"]} / {p["code"]} {p["name"]}', f'Item: {x["item"]}']
    if x["kind"] == "Task":
        boss = f'   Reports to: {x["boss"]["n"]}' if x["boss"] and x["boss"]["n"] else ""
        lines += [f'Function: {x["fn"]}   SPOC: {x["spoc"]["n"] or "Unassigned"}{boss}',
                  f'Planned finish: {fmt(x["due"])}   Pending for: {x["late"]} days past due   Progress: {x["progress"]}%']
        if x["crit"]:
            lines.append("This task is on the critical path. Each day of delay moves the FPR and launch.")
    elif x["kind"] == "Gate":
        lines.append(f'Planned gate date: {fmt(x["due"])}   Days overdue: {x["late"]}')
    else:
        lines.append(f'Target launch: {fmt(x["due"])}   Forecast launch: {fmt(x["launch"])}')
    lines += [f'FPR (First Production Run): {fmt(x["fpr"])}   Forecast launch: {fmt(x["launch"])}   Target: {fmt(p["target"])}', "",
              f'Please share a recovery plan or a revised date by {fmt(today + dt.timedelta(days=M["reply_days"]))}.', "",
              f'Escalation matrix: L1 SPOC with boss in copy (pending more than {M["l1"]} days), L2 boss (more than {M["l2"]} days or critical path), '
              f'L3 brand manager and {M["npd_head"]} (more than {M["l3"]} days, FPR-critical or launch at risk).', "", M["signature"]]
    to = "; ".join(c["e"] for c in x["to"] if c["e"])
    cc = "; ".join(c["e"] for c in x["cc"] if c["e"])
    return subject, "\n".join(lines), to, cc


# --------------------------------------------------------------------------- send log (stops repeat mails)
LOG_FIELDS = ["date", "key", "level", "to", "cc", "subject", "result"]


def read_log(path):
    last = {}
    if path.exists():
        with path.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r.get("result", "").startswith(("sent", "draft")):
                    d = to_date(r["date"])
                    k = (r["key"], r["level"])
                    if d and (k not in last or d > last[k]):
                        last[k] = d
    return last


def append_log(path, rows):
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=LOG_FIELDS)
        if new:
            w.writeheader()
        w.writerows(rows)


# --------------------------------------------------------------------------- mail channels
def outlook_send(mails, mode, account=None):
    try:
        import win32com.client  # type: ignore
    except ImportError:
        sys.exit("Outlook mode needs Windows with Outlook desktop and pywin32:  pip install pywin32")
    app = win32com.client.Dispatch("Outlook.Application")
    acct = None
    if account:
        for a in app.Session.Accounts:
            if a.SmtpAddress.lower() == account.lower():
                acct = a
                break
    results = []
    for subject, body, to, cc in mails:
        try:
            m = app.CreateItem(0)
            m.To, m.CC, m.Subject, m.Body = to, cc, subject, body
            if acct is not None:
                m._oleobj_.Invoke(*(64209, 0, 8, 0, acct))  # SendUsingAccount
            if mode == "send":
                m.Send()
                results.append("sent")
            else:
                m.Save()
                results.append("draft")
        except Exception as e:  # keep going for the other mails
            results.append(f"error: {e}")
    return results


def smtp_send(mails, cfg):
    host, port = cfg.get("smtp_host", "smtp.office365.com"), int(cfg.get("smtp_port", "587"))
    user = cfg.get("smtp_user") or os.environ.get("NPD_SMTP_USER", "")
    pwd = os.environ.get("NPD_SMTP_PASSWORD", "")
    if not user or not pwd:
        sys.exit("SMTP mode needs smtp_user in config.ini and the NPD_SMTP_PASSWORD environment variable.")
    results = []
    with smtplib.SMTP(host, port, timeout=30) as s:
        s.starttls()
        s.login(user, pwd)
        for subject, body, to, cc in mails:
            msg = EmailMessage()
            msg["From"], msg["To"], msg["Subject"] = user, to.replace(";", ","), subject
            if cc:
                msg["Cc"] = cc.replace(";", ",")
            msg.set_content(body)
            try:
                s.send_message(msg)
                results.append("sent")
            except Exception as e:
                results.append(f"error: {e}")
    return results


def write_preview(items, mails, path):
    cards = []
    for x, (subject, body, to, cc) in zip(items, mails):
        cards.append(f"<section><p><b>L{x['level']}</b> &middot; {html.escape(x['p']['brand'])} &middot; {html.escape(x['p']['code'])}</p>"
                     f"<p><b>To:</b> {html.escape(to or '(no email on file)')}<br><b>Cc:</b> {html.escape(cc)}<br><b>Subject:</b> {html.escape(subject)}</p>"
                     f"<pre>{html.escape(body)}</pre></section>")
    path.write_text("<!doctype html><meta charset='utf-8'><title>NPD escalation preview</title>"
                    "<style>body{font:14px system-ui;max-width:900px;margin:24px auto;padding:0 16px}section{border:1px solid #ccc;border-radius:8px;padding:12px 16px;margin:12px 0}"
                    "pre{white-space:pre-wrap;font:13px ui-monospace,monospace;background:#f5f5f5;padding:10px}</style>"
                    f"<h1>{len(mails)} escalation email(s)</h1>" + "".join(cards), encoding="utf-8")


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Send NPD escalation emails through Outlook.")
    ap.add_argument("--config", default=str(HERE / "config.ini"))
    ap.add_argument("--workbook", help="Path to the master workbook (overrides config.ini)")
    ap.add_argument("--mode", choices=["preview", "draft", "send", "smtp"], help="Overrides config.ini")
    ap.add_argument("--preview", action="store_true", help="Same as --mode preview")
    ap.add_argument("--today", help="Run as if today is YYYY-MM-DD (testing)")
    ap.add_argument("--force", action="store_true", help="Ignore the repeat interval and mail everything that is open")
    a = ap.parse_args()

    cp = configparser.ConfigParser()
    cp.read(a.config, encoding="utf-8")
    cfg = cp["automailer"] if cp.has_section("automailer") else {}
    wb_path = Path(os.path.expandvars(os.path.expanduser(a.workbook or cfg.get("workbook", ""))))
    if not wb_path.is_file():
        sys.exit(f'Workbook not found: "{wb_path}". Set "workbook" in config.ini to the file in your OneDrive folder.')
    mode = "preview" if a.preview else (a.mode or cfg.get("mode", "preview"))
    repeat = int(cfg.get("repeat_every_days", "2"))
    test_to = cfg.get("test_recipient", "").strip()
    today = to_date(a.today) if a.today else dt.date.today()
    log_path = Path(os.path.expandvars(os.path.expanduser(cfg.get("log_file", "")))) if cfg.get("log_file") else wb_path.with_name("NPD_Automailer_Log.csv")

    projects, brands, functions, people, M = load_workbook_data(wb_path)
    items = find_escalations(projects, brands, functions, people, M, today)
    last = read_log(log_path)
    due = [x for x in items if a.force or mode == "preview" or
           (last.get((x["key"], f'L{x["level"]}')) is None or (today - last[(x["key"], f'L{x["level"]}')]).days >= repeat)]
    mails = [compose(x, M, today) for x in due]
    no_addr = [x for x, m in zip(due, mails) if not m[2]]
    if test_to:  # safe testing: everything goes to one mailbox
        mails = [(f"[TEST to {m[2] or 'nobody'}] {m[0]}", m[1], test_to, "") for m in mails]

    print(f"{len(items)} open escalation(s), {len(due)} due today ({mode} mode).")
    if no_addr:
        print(f"{len(no_addr)} have no email on file. Fill the People, Functions and Brands sheets.")
    if mode == "preview":
        out = HERE / "escalation_preview.html"
        write_preview(due, mails, out)
        print(f"Preview written to {out}")
        return
    sendable = [(x, m) for x, m in zip(due, mails) if m[2]]
    if not sendable:
        print("Nothing to send.")
        return
    xs, ms = zip(*sendable)
    if mode in ("send", "draft"):
        results = outlook_send(ms, mode, cfg.get("send_from_account", "").strip() or None)
    else:
        results = smtp_send(ms, cfg)
    append_log(log_path, [{"date": today.isoformat(), "key": x["key"], "level": f'L{x["level"]}', "to": m[2], "cc": m[3],
                           "subject": m[0], "result": r} for x, m, r in zip(xs, ms, results)])
    ok = sum(r in ("sent", "draft") for r in results)
    print(f"{ok} of {len(ms)} email(s) {'sent' if mode != 'draft' else 'saved as drafts'}. Log: {log_path}")


if __name__ == "__main__":
    main()

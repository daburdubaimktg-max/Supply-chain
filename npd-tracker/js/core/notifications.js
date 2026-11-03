// Notification rule engine (PROTOTYPE: entries are written to the Notification Log
// and shown in the Escalation Centre; nothing is e-mailed until Power Automate is
// connected – see docs/POWER-AUTOMATE-FLOWS.md).
//
// In production, Power Automate polls the Notification Log list for rows with
// emailStatus = 'QUEUED', sends via Outlook and writes back SENT / FAILED + error.

import { COLLECTIONS, NOTIFICATION_TYPES, TASK_STATUS, APPROVAL_STATUS } from './models.js';
import { diffWorkingDays, today as todayStr } from './calendar.js';
import { blockingPredecessors, taskMetrics } from './performance.js';

export class Notifier {
  constructor(store) { this.store = store; }

  stakeholder(id) { return id ? this.store.get(COLLECTIONS.stakeholders, id) : null; }
  config() { return this.store.config(); }

  recipientsFor(task, kind) {
    const fpr = this.stakeholder(task.fprId);
    const approver = this.stakeholder(task.approverId);
    const manager = this.stakeholder(fpr?.managerId);
    const escalation = this.stakeholder(task.escalationId) || manager;
    const project = this.store.get(COLLECTIONS.projects, task.projectId);
    const owner = this.stakeholder(project?.ownerId);
    const cc = new Set();
    for (const id of task.notifyIds || []) { const s = this.stakeholder(id); if (s) cc.add(s.email); }
    if (this.config().notifications?.ccProjectOwner && owner) cc.add(owner.email);
    const to = [];
    switch (kind) {
      case NOTIFICATION_TYPES.ESCALATION: if (escalation) to.push(escalation.email); if (fpr) cc.add(fpr.email); break;
      case NOTIFICATION_TYPES.APPROVAL_REQUESTED: if (approver) to.push(approver.email); if (fpr) cc.add(fpr.email); break;
      case NOTIFICATION_TYPES.COMPLETED: if (owner) to.push(owner.email); if (approver) cc.add(approver.email); break;
      default: if (fpr) to.push(fpr.email); if (fpr?.backupFprId) { const b = this.stakeholder(fpr.backupFprId); if (b) cc.add(b.email); }
    }
    to.forEach((e) => cc.delete(e));
    return { to: Array.from(new Set(to)), cc: Array.from(cc) };
  }

  payload(task, extra = {}) {
    const project = this.store.get(COLLECTIONS.projects, task.projectId) || {};
    const fpr = this.stakeholder(task.fprId);
    const cal = this.store.calendar();
    const deps = this.store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === task.projectId);
    const tasksById = new Map(this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === task.projectId).map((t) => [t.id, t]));
    const blocking = blockingPredecessors(task, tasksById, deps).map((p) => p.name);
    return {
      projectId: project.projectCode || project.id,
      projectName: project.name,
      brand: project.brand,
      taskId: task.activityNo ?? task.id,
      taskName: task.name,
      department: task.department,
      assignedFpr: fpr?.employeeName || '—',
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      actualStart: task.actualStart,
      delayDays: taskMetrics(task, cal).delayDays,
      blockingPredecessor: blocking.join(', ') || null,
      requiredAction: extra.requiredAction || '',
      dashboardUrl: `${this.config().notifications?.dashboardUrl || ''}#/tasks/${task.id}`,
      ...extra,
    };
  }

  // Duplicate prevention key: one notification per task/type/day (events) or per task/type/date-bucket (reminders)
  alreadyLogged(taskId, type, dedupeKey) {
    return this.store.all(COLLECTIONS.notificationLog).some((n) => n.taskId === taskId && n.type === type && n.dedupeKey === dedupeKey);
  }

  async log(task, type, { requiredAction, dedupeKey, extra } = {}) {
    if (this.config().notifications?.enabled === false) return null;
    const key = dedupeKey || `${type}:${todayStr()}`;
    if (this.alreadyLogged(task.id, type, key)) return null;
    const { to, cc } = this.recipientsFor(task, type);
    const mode = this.config().emailAutomation || 'logged';
    return this.store.append(COLLECTIONS.notificationLog, {
      projectId: task.projectId,
      taskId: task.id,
      type,
      recipient: to.join('; ') || '(no recipient configured)',
      cc: cc.join('; '),
      subject: subjectFor(type, task),
      payload: this.payload(task, { requiredAction, ...extra }),
      emailStatus: mode === 'powerautomate' ? 'QUEUED' : 'LOGGED (prototype – not sent)',
      errorDetails: to.length ? null : 'No recipient e-mail configured',
      dedupeKey: key,
    });
  }

  // Scheduled rules – run on app load and from the Escalation Centre "Run checks" button.
  // In production this is a Power Automate recurrence flow.
  async runScheduledChecks(today = todayStr()) {
    const cfg = this.config();
    const cal = this.store.calendar();
    const created = [];
    const tasks = this.store.where(COLLECTIONS.projectTasks, (t) => t.isActive !== false
      && ![TASK_STATUS.COMPLETED, TASK_STATUS.NOT_REQUIRED, TASK_STATUS.ON_HOLD].includes(t.status) && t.plannedEnd);
    await this.store.batch(async () => {
      for (const t of tasks) {
        const daysToDue = diffWorkingDays(today, t.plannedEnd, cal); // positive = in future
        let n = null;
        if (daysToDue > 0 && daysToDue <= Number(cfg.reminderBeforeDays ?? 2)) {
          n = await this.log(t, NOTIFICATION_TYPES.UPCOMING, { requiredAction: `Complete before ${t.plannedEnd}`, dedupeKey: `${NOTIFICATION_TYPES.UPCOMING}:${t.plannedEnd}` });
        } else if (daysToDue === 0) {
          n = await this.log(t, NOTIFICATION_TYPES.DUE_TODAY, { requiredAction: 'Task is due today', dedupeKey: `${NOTIFICATION_TYPES.DUE_TODAY}:${t.plannedEnd}` });
        } else if (daysToDue < 0) {
          const overdue = -daysToDue;
          n = await this.log(t, NOTIFICATION_TYPES.OVERDUE, { requiredAction: `Overdue by ${overdue} working day(s)`, dedupeKey: `${NOTIFICATION_TYPES.OVERDUE}:${today}` });
          if (n) created.push(n);
          const levels = (cfg.escalationLevels || []).filter((l) => overdue >= Number(l.afterDays));
          for (const lvl of levels) {
            const e = await this.log(t, NOTIFICATION_TYPES.ESCALATION, {
              requiredAction: `Escalation level ${lvl.level}: overdue ${overdue} working days`,
              dedupeKey: `${NOTIFICATION_TYPES.ESCALATION}:L${lvl.level}`,
              extra: { escalationLevel: lvl.level, escalationRecipientRole: lvl.recipient },
            });
            if (e) created.push(e);
          }
          n = null;
        }
        if (n) created.push(n);
      }
    });
    return created;
  }
}

export function subjectFor(type, task) {
  const map = {
    [NOTIFICATION_TYPES.UPCOMING]: 'Upcoming NPD task due',
    [NOTIFICATION_TYPES.DUE_TODAY]: 'NPD task due today',
    [NOTIFICATION_TYPES.OVERDUE]: 'NPD task OVERDUE',
    [NOTIFICATION_TYPES.ESCALATION]: 'ESCALATION – NPD task overdue',
    [NOTIFICATION_TYPES.COMPLETED]: 'NPD task completed',
    [NOTIFICATION_TYPES.BLOCKED]: 'NPD task blocked by predecessor',
    [NOTIFICATION_TYPES.FPR_CHANGED]: 'You have been assigned an NPD task',
    [NOTIFICATION_TYPES.APPROVAL_REQUESTED]: 'Approval requested – NPD task',
    [NOTIFICATION_TYPES.REJECTED]: 'NPD task returned for correction',
    [NOTIFICATION_TYPES.PROJECT_COMPLETED]: 'NPD project closed',
    [NOTIFICATION_TYPES.TASK_RELEASED]: 'NPD task is ready to start',
  };
  return `${map[type] || type}: ${task.name}`;
}

export { APPROVAL_STATUS };

// Data model: collection names (map 1:1 to the proposed SharePoint Lists),
// status enums and record factories. Nothing in here is business data —
// all activities, dependencies and stakeholders live in the store as editable records.

export const COLLECTIONS = {
  projects: 'projects',               // Project Master
  activityMaster: 'activityMaster',   // NPD Activity Master
  masterDependencies: 'masterDependencies', // default dependencies for the master
  projectTasks: 'projectTasks',       // Project Task Master
  taskDependencies: 'taskDependencies', // Task Dependency Master (one row per predecessor)
  stakeholders: 'stakeholders',       // Stakeholder Master
  approvalHistory: 'approvalHistory', // Approval History (append-only)
  notificationLog: 'notificationLog', // Notification Log
  workingCalendar: 'workingCalendar', // Working Calendar (weekend + holidays)
  systemConfig: 'systemConfig',       // System Configuration (single record)
  auditLog: 'auditLog',               // Audit history (append-only)
  taskHistory: 'taskHistory',         // Per-task event history (append-only)
  scheduleBaselines: 'scheduleBaselines',
  templates: 'templates',             // Saved project templates
  comments: 'comments',
};

export const TASK_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  BLOCKED: 'BLOCKED',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  NOT_REQUIRED: 'NOT_REQUIRED',
};

// Derived performance classification (computed, never stored as truth)
export const PERF_STATUS = {
  NOT_STARTED: 'NOT STARTED',
  BLOCKED: 'BLOCKED',
  IN_PROGRESS: 'IN PROGRESS',
  DUE_SOON: 'DUE SOON',
  AT_RISK: 'AT RISK',
  OVERDUE: 'OVERDUE',
  PENDING_APPROVAL: 'PENDING APPROVAL',
  COMPLETED_ON_TIME: 'COMPLETED ON TIME',
  COMPLETED_LATE: 'COMPLETED LATE',
  ON_HOLD: 'ON HOLD',
  NOT_REQUIRED: 'NOT REQUIRED',
};

export const APPROVAL_STATUS = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const PROJECT_STATUS = {
  PLANNING: 'PLANNING',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

export const ROLES = {
  ADMIN: 'Administrator',
  DEPT_HEAD: 'Department Head',
  FPR: 'FPR',
  MANAGEMENT: 'Management',
};

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const PROJECT_KINDS = ['NPD', 'Transition'];
export const SCHEDULING_MODES = ['FORWARD', 'BACKWARD'];

export const NOTIFICATION_TYPES = {
  UPCOMING: 'UPCOMING_REMINDER',
  DUE_TODAY: 'DUE_TODAY',
  OVERDUE: 'OVERDUE',
  ESCALATION: 'ESCALATION',
  COMPLETED: 'TASK_COMPLETED',
  BLOCKED: 'TASK_BLOCKED',
  FPR_CHANGED: 'FPR_CHANGED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  REJECTED: 'TASK_REJECTED',
  PROJECT_COMPLETED: 'PROJECT_COMPLETED',
  TASK_RELEASED: 'TASK_RELEASED',
};

let idCounter = 0;
export function newId(prefix = 'id') {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function baseRecord(user, extra = {}) {
  const ts = nowIso();
  return {
    version: 1,
    isActive: true,
    createdBy: user?.name || 'system',
    createdAt: ts,
    modifiedBy: user?.name || 'system',
    modifiedAt: ts,
    ...extra,
  };
}

// Factories -----------------------------------------------------------------

export function makeActivity(data, user) {
  return {
    id: data.id || newId('act'),
    ...baseRecord(user),
    activityNo: data.activityNo,           // editable activity number
    sequence: data.sequence ?? data.activityNo,
    name: data.name,
    department: data.department,
    defaultFprId: data.defaultFprId || null,
    expectedDuration: Number(data.expectedDuration ?? 0),
    isMandatory: data.isMandatory ?? true,
    approvalRequired: data.approvalRequired ?? false,
    description: data.description || '',
    instructions: data.instructions || '',
    ...data,
  };
}

export function makeProject(data, user) {
  return {
    id: data.id || newId('prj'),
    ...baseRecord(user),
    projectCode: data.projectCode,
    name: data.name,
    brand: data.brand,
    category: data.category,
    categoryHead: data.categoryHead || '',
    kind: data.kind || 'NPD',             // NPD / Transition
    projectType: data.projectType || '',
    size: data.size || '',
    variant: data.variant || '',
    productDescription: data.productDescription || '',
    ownerId: data.ownerId || null,
    launchDate: data.launchDate || null,
    priority: data.priority || 'Medium',
    status: data.status || PROJECT_STATUS.PLANNING,
    schedulingMode: data.schedulingMode || 'FORWARD',
    anchorDate: data.anchorDate || null,
    actualStartDate: null,
    actualStartBy: null,
    plannedEndDate: null,
    actualEndDate: null,
    actualEndBy: null,
    closureHistory: [],
    isSample: data.isSample || false,
    ...data,
  };
}

export function makeTask(data, user) {
  return {
    id: data.id || newId('tsk'),
    ...baseRecord(user),
    projectId: data.projectId,
    activityId: data.activityId || null,    // link to master (null for ad-hoc tasks)
    activityNo: data.activityNo,
    sequence: data.sequence ?? data.activityNo,
    name: data.name,
    department: data.department,
    fprId: data.fprId || null,
    backupFprId: data.backupFprId || null,
    approverId: data.approverId || null,
    escalationId: data.escalationId || null,
    notifyIds: data.notifyIds || [],
    expectedDuration: Number(data.expectedDuration ?? 0),
    isMandatory: data.isMandatory ?? true,
    approvalRequired: data.approvalRequired ?? false,
    priority: data.priority || 'Medium',
    status: data.status || TASK_STATUS.NOT_STARTED,
    approvalStatus: data.approvalRequired ? APPROVAL_STATUS.NOT_SUBMITTED : APPROVAL_STATUS.NOT_REQUIRED,
    plannedStart: data.plannedStart || null,
    plannedEnd: data.plannedEnd || null,
    manualPlannedStart: data.manualPlannedStart || null, // user override (anchors the task)
    forecastStart: null,
    forecastEnd: null,
    actualStart: null,
    actualStartBy: null,
    actualEnd: null,
    actualEndBy: null,
    submittedAt: null,
    submittedBy: null,
    rejectionReason: null,
    description: data.description || '',
    instructions: data.instructions || '',
    isCritical: false,
    ...data,
  };
}

export function makeDependency(data, user) {
  return {
    id: data.id || newId('dep'),
    ...baseRecord(user),
    projectId: data.projectId || null,     // null => master dependency
    taskId: data.taskId,                   // successor
    predecessorId: data.predecessorId,
    type: data.type || 'FS',
    lagDays: Number(data.lagDays ?? 0),
    ...data,
  };
}

export function makeStakeholder(data, user) {
  return {
    id: data.id || newId('stk'),
    ...baseRecord(user),
    employeeName: data.employeeName,
    department: data.department,
    designation: data.designation || '',
    email: data.email,
    managerId: data.managerId || null,
    backupFprId: data.backupFprId || null,
    role: data.role || ROLES.FPR,
    ...data,
  };
}

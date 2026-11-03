// Simulated authentication (PROTOTYPE). In production replace `signIn` with
// MSAL / Entra ID and derive the role from group membership; the server must
// re-validate every permission check performed here.

import { ROLES, COLLECTIONS } from './models.js';

const SESSION_KEY = 'npd_tracker::session';

export const ACTIONS = {
  VIEW_ALL: 'VIEW_ALL',
  CREATE_PROJECT: 'CREATE_PROJECT',
  EDIT_PROJECT: 'EDIT_PROJECT',
  EDIT_MASTER: 'EDIT_MASTER',
  EDIT_TASK: 'EDIT_TASK',
  EDIT_DEPENDENCIES: 'EDIT_DEPENDENCIES',
  EDIT_FPR: 'EDIT_FPR',
  EDIT_STAKEHOLDERS: 'EDIT_STAKEHOLDERS',
  CONFIGURE_APPROVALS: 'CONFIGURE_APPROVALS',
  START_TASK: 'START_TASK',
  SUBMIT_TASK: 'SUBMIT_TASK',
  APPROVE_TASK: 'APPROVE_TASK',
  COMPLETE_TASK: 'COMPLETE_TASK',
  REOPEN_TASK: 'REOPEN_TASK',
  MARK_NOT_REQUIRED: 'MARK_NOT_REQUIRED',
  ADD_COMMENT: 'ADD_COMMENT',
  ESCALATE: 'ESCALATE',
  CONFIGURE_SYSTEM: 'CONFIGURE_SYSTEM',
  IMPORT_DATA: 'IMPORT_DATA',
  EXPORT_DATA: 'EXPORT_DATA',
  RESET_DATA: 'RESET_DATA',
};

const ROLE_GRANTS = {
  [ROLES.ADMIN]: new Set(Object.values(ACTIONS)),
  [ROLES.DEPT_HEAD]: new Set([
    ACTIONS.VIEW_ALL, ACTIONS.APPROVE_TASK, ACTIONS.ESCALATE, ACTIONS.ADD_COMMENT, ACTIONS.EXPORT_DATA,
    ACTIONS.START_TASK, ACTIONS.SUBMIT_TASK, ACTIONS.COMPLETE_TASK, ACTIONS.EDIT_TASK, ACTIONS.EDIT_FPR,
    ACTIONS.MARK_NOT_REQUIRED,
  ]),
  [ROLES.FPR]: new Set([
    ACTIONS.VIEW_ALL, ACTIONS.START_TASK, ACTIONS.SUBMIT_TASK, ACTIONS.COMPLETE_TASK, ACTIONS.EDIT_TASK,
    ACTIONS.ADD_COMMENT, ACTIONS.EXPORT_DATA,
  ]),
  [ROLES.MANAGEMENT]: new Set([ACTIONS.VIEW_ALL, ACTIONS.EXPORT_DATA, ACTIONS.ADD_COMMENT]),
};

// Task fields each role may edit (Admin: all)
export const FPR_EDITABLE_FIELDS = new Set(['description', 'instructions', 'priority']);
export const DEPT_HEAD_EDITABLE_FIELDS = new Set(['description', 'instructions', 'priority', 'fprId', 'backupFprId', 'expectedDuration']);

export class Auth {
  constructor(store) {
    this.store = store;
    this.user = null;
  }

  users() { return this.store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive); }

  restore() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
      if (raw) {
        const { id } = JSON.parse(raw);
        const u = this.store.get(COLLECTIONS.stakeholders, id);
        if (u) return this.signIn(u.id);
      }
    } catch { /* ignore */ }
    const admin = this.users().find((u) => u.role === ROLES.ADMIN) || this.users()[0];
    return admin ? this.signIn(admin.id) : null;
  }

  signIn(stakeholderId) {
    const u = this.store.get(COLLECTIONS.stakeholders, stakeholderId);
    if (!u) throw new Error('Unknown user');
    this.user = { id: u.id, name: u.employeeName, email: u.email, role: u.role, department: u.department };
    this.store.currentUser = this.user;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id })); } catch { /* ignore */ }
    return this.user;
  }

  is(role) { return this.user?.role === role; }
  isAdmin() { return this.is(ROLES.ADMIN); }

  // Permission check. `ctx` may carry { task, project } for ownership checks.
  can(action, ctx = {}) {
    if (!this.user) return false;
    const grants = ROLE_GRANTS[this.user.role];
    if (!grants || !grants.has(action)) return false;
    if (this.isAdmin()) return true;
    const { task } = ctx;
    if (!task) return true;
    const owns = task.fprId === this.user.id || task.backupFprId === this.user.id;
    const sameDept = task.department === this.user.department;
    const isApprover = task.approverId === this.user.id;
    switch (action) {
      case ACTIONS.START_TASK:
      case ACTIONS.SUBMIT_TASK:
      case ACTIONS.COMPLETE_TASK:
        return owns || (this.is(ROLES.DEPT_HEAD) && sameDept);
      case ACTIONS.APPROVE_TASK:
        return isApprover || (this.is(ROLES.DEPT_HEAD) && sameDept);
      case ACTIONS.EDIT_TASK:
      case ACTIONS.EDIT_FPR:
      case ACTIONS.MARK_NOT_REQUIRED:
        return owns || (this.is(ROLES.DEPT_HEAD) && sameDept);
      case ACTIONS.ESCALATE:
        return this.is(ROLES.DEPT_HEAD) && sameDept;
      default:
        return true;
    }
  }

  editableTaskFields() {
    if (this.isAdmin()) return null; // null = all fields
    if (this.is(ROLES.DEPT_HEAD)) return DEPT_HEAD_EDITABLE_FIELDS;
    if (this.is(ROLES.FPR)) return FPR_EDITABLE_FIELDS;
    return new Set();
  }

  assert(action, ctx) {
    if (!this.can(action, ctx)) {
      const err = new Error(`Permission denied: ${this.user?.name || 'anonymous'} (${this.user?.role || 'no role'}) cannot ${action.replace(/_/g, ' ').toLowerCase()}.`);
      err.name = 'PermissionError';
      throw err;
    }
  }
}

// Initial baseline (loaded ONCE into the database when it is empty).
// After seeding, everything here is an ordinary editable record – the app
// never reads these arrays again. Edit via the dashboard, not here.

import { COLLECTIONS, ROLES, makeActivity, makeStakeholder, makeDependency } from './models.js';

export const SEED_STAKEHOLDERS = [
  { key: 'admin',   employeeName: 'System Administrator', department: 'IT',              designation: 'NPD System Admin',          email: 'npd.admin@example.com',        role: ROLES.ADMIN },
  { key: 'bharath', employeeName: 'Bharath',    department: 'Marketing',       designation: 'Brand Manager',        email: 'bharath@example.com',   role: ROLES.FPR,       managerKey: 'mkthead' },
  { key: 'mayuresh',employeeName: 'Mayuresh',   department: 'Packaging',       designation: 'Packaging Development',email: 'mayuresh@example.com',  role: ROLES.FPR,       managerKey: 'pkghead' },
  { key: 'nasir',   employeeName: 'Nasir',      department: 'R&D',             designation: 'R&D Lead',             email: 'nasir@example.com',     role: ROLES.FPR,       managerKey: 'rndhead', backupKey: 'rahul' },
  { key: 'rahul',   employeeName: 'Rahul',      department: 'R&D',             designation: 'R&D Scientist',        email: 'rahul@example.com',     role: ROLES.FPR,       managerKey: 'rndhead', backupKey: 'nasir' },
  { key: 'pranjal', employeeName: 'Pranjal',    department: 'Production',      designation: 'Production Planner',   email: 'pranjal@example.com',   role: ROLES.FPR,       managerKey: 'opshead' },
  { key: 'parth',   employeeName: 'Parth',      department: 'Planning',        designation: 'Supply Planner',       email: 'parth@example.com',     role: ROLES.FPR,       managerKey: 'opshead' },
  { key: 'atharva', employeeName: 'Atharva',    department: 'Procurement',     designation: 'Procurement Executive',email: 'atharva@example.com',   role: ROLES.FPR,       managerKey: 'opshead' },
  { key: 'tukuna',  employeeName: 'Tukuna',     department: 'Inward Quality',  designation: 'QA – Inward',          email: 'tukuna@example.com',    role: ROLES.FPR,       managerKey: 'qahead' },
  { key: 'hulyan',  employeeName: 'Hulyan',     department: 'Production',      designation: 'Production Manager',   email: 'hulyan@example.com',    role: ROLES.FPR,       managerKey: 'opshead' },
  { key: 'arun',    employeeName: 'Arun Radhakrishnan', department: 'Outward Quality', designation: 'QA – Outward', email: 'arun.r@example.com',    role: ROLES.FPR,       managerKey: 'qahead' },
  { key: 'mkthead', employeeName: 'Marketing Head',  department: 'Marketing',  designation: 'Head of Marketing',    email: 'marketing.head@example.com', role: ROLES.DEPT_HEAD },
  { key: 'pkghead', employeeName: 'Packaging Head',  department: 'Packaging',  designation: 'Head of Packaging',    email: 'packaging.head@example.com', role: ROLES.DEPT_HEAD },
  { key: 'rndhead', employeeName: 'R&D Head',        department: 'R&D',        designation: 'Head of R&D',          email: 'rnd.head@example.com',       role: ROLES.DEPT_HEAD },
  { key: 'opshead', employeeName: 'Operations Head', department: 'Production', designation: 'Head of Operations',   email: 'ops.head@example.com',       role: ROLES.DEPT_HEAD },
  { key: 'qahead',  employeeName: 'Quality Head',    department: 'Inward Quality', designation: 'Head of Quality',  email: 'quality.head@example.com',   role: ROLES.DEPT_HEAD },
  { key: 'mgmt',    employeeName: 'Management Viewer', department: 'Management', designation: 'Director',           email: 'management@example.com',     role: ROLES.MANAGEMENT },
];

// Activity No, Name, Department, Default FPR key, Duration, Predecessors, approvalRequired
export const SEED_ACTIVITIES = [
  [1,  'Product Brief',              'Marketing',       'bharath',  8,  [],           true],
  [2,  'NPPF/SRP',                   'Marketing',       'bharath',  0,  [],           true],
  [3,  'Project Start Date',         'Marketing',       'bharath',  0,  [2],          false],
  [4,  'FG Code',                    'Marketing',       'bharath',  8,  [2],          false],
  [5,  'Packaging Closure',          'Packaging',       'mayuresh', 20, [2],          true],
  [6,  'Mould Development',          'Packaging',       'mayuresh', 0,  [5],          false],
  [7,  'Stability Start Date',       'R&D',             'nasir',    0,  [2],          false],
  [8,  'Stability End',              'R&D',             'nasir',    0,  [7],          true],
  [9,  'Bulk Code',                  'R&D',             'nasir',    4,  [8],          false],
  [10, 'PM for Trial',               'Packaging',       'mayuresh', 15, [2, 6],       false],
  [11, 'Line Trial',                 'Packaging',       'mayuresh', 5,  [10],         true],
  [12, 'TT',                         'Packaging',       'mayuresh', 2,  [11],         false],
  [13, 'Barcodes',                   'Packaging',       'mayuresh', 5,  [4],          false],
  [14, 'PM Codes',                   'Packaging',       'mayuresh', 10, [4],          false],
  [15, 'Spec',                       'Packaging',       'mayuresh', 5,  [5],          false],
  [16, 'FG/PM BOM',                  'Packaging',       'mayuresh', 6,  [4, 9, 14],   false],
  [17, 'Routing',                    'Production',      'pranjal',  3,  [16],         false],
  [18, 'PR',                         'Planning',        'parth',    2,  [17],         false],
  [19, 'Canvas Initiate',            'Marketing',       'bharath',  3,  [4, 12, 14],  false],
  [20, 'Canvas Approval',            'Marketing',       'bharath',  6,  [19],         true],
  [21, 'Costing from Supplier',      'Packaging',       'mayuresh', 5,  [12, 14, 20, 15], false],
  [22, 'Artwork Sending to Supplier','Packaging',       'mayuresh', 2,  [20],         false],
  [23, 'Vendor Proof Approval',      'Packaging',       'mayuresh', 3,  [22],         true],
  [24, 'Proofing',                   'Packaging',       'mayuresh', 8,  [22],         false],
  [25, 'GPA',                        'Procurement',     'atharva',  5,  [21],         true],
  [26, 'PO Date',                    'Procurement',     'atharva',  4,  [18, 21, 25], false],
  [27, 'PM ETA (Delivery Date)',     'Procurement',     'atharva',  30, [26],         false],
  [28, 'PM QA Clearance',            'Inward Quality',  'tukuna',   3,  [27],         true],
  [29, 'Production',                 'Production',      'hulyan',   6,  [28],         false],
  [30, 'FG QA Clearance',            'Outward Quality', 'arun',     2,  [29],         true],
];

export const DEFAULT_CONFIG = {
  id: 'cfg_main',
  companyName: 'FMCG NPD & Transition Tracker',
  dueSoonThresholdDays: 2,        // working days before planned end => DUE SOON
  atRiskThresholdDays: 0,         // forecast end beyond planned end by > N working days => AT RISK
  defaultSchedulingMode: 'FORWARD',
  significantChangeDays: 5,       // schedule shift (working days) that triggers a confirmation dialog
  dataAdapter: 'localStorage',    // 'localStorage' (prototype) | 'sharepoint' (production, requires configuration)
};

export const DEFAULT_CALENDAR = {
  id: 'cal_main',
  weekendDays: [0, 6], // Sunday, Saturday
  holidays: [
    { date: '2026-01-01', name: 'New Year', type: 'Public' },
    { date: '2026-12-02', name: 'National Day', type: 'Public' },
    { date: '2026-12-03', name: 'National Day Holiday', type: 'Public' },
    { date: '2026-12-25', name: 'Christmas', type: 'Company' },
  ],
};

// Builds all master records. Returns { stakeholders, activities, masterDependencies }.
export function buildMasterSeed() {
  const byKey = {};
  const stakeholders = SEED_STAKEHOLDERS.map((s) => {
    const rec = makeStakeholder({
      id: `stk_${s.key}`,
      employeeName: s.employeeName,
      department: s.department,
      designation: s.designation,
      email: s.email,
      role: s.role,
    });
    byKey[s.key] = rec;
    return rec;
  });
  for (const s of SEED_STAKEHOLDERS) {
    const rec = byKey[s.key];
    rec.managerId = s.managerKey ? byKey[s.managerKey].id : null;
    rec.backupFprId = s.backupKey ? byKey[s.backupKey].id : null;
  }

  const activities = SEED_ACTIVITIES.map(([no, name, dept, fprKey, dur, , approval]) => makeActivity({
    id: `act_${String(no).padStart(2, '0')}`,
    activityNo: no,
    sequence: no,
    name,
    department: dept,
    defaultFprId: byKey[fprKey].id,
    expectedDuration: dur,
    isMandatory: true,
    approvalRequired: approval,
    description: '',
    instructions: '',
  }));

  const masterDependencies = [];
  for (const [no, , , , , preds] of SEED_ACTIVITIES) {
    for (const p of preds) {
      masterDependencies.push(makeDependency({
        id: `mdep_${no}_${p}`,
        projectId: null,
        taskId: `act_${String(no).padStart(2, '0')}`,
        predecessorId: `act_${String(p).padStart(2, '0')}`,
        type: 'FS',
        lagDays: 0,
      }));
    }
  }

  return { stakeholders, activities, masterDependencies, byKey };
}

export async function seedMasters(store) {
  const { stakeholders, activities, masterDependencies } = buildMasterSeed();
  store._auditEnabled = false;
  await store.batch(async () => {
    for (const s of stakeholders) await store.insert(COLLECTIONS.stakeholders, s, { audit: false });
    for (const a of activities) await store.insert(COLLECTIONS.activityMaster, a, { audit: false });
    for (const d of masterDependencies) await store.insert(COLLECTIONS.masterDependencies, d, { audit: false });
    await store.insert(COLLECTIONS.systemConfig, { ...DEFAULT_CONFIG }, { audit: false });
    await store.insert(COLLECTIONS.workingCalendar, { ...DEFAULT_CALENDAR }, { audit: false });
  });
  store._auditEnabled = true;
  await store.append(COLLECTIONS.auditLog, {
    collection: 'system', recordId: 'seed', action: 'SEED',
    summary: `Loaded initial baseline: ${activities.length} activities, ${masterDependencies.length} dependencies, ${stakeholders.length} stakeholders`,
    changes: [],
  });
}

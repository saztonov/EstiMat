export type Role =
  | 'admin'
  | 'director'
  | 'project_manager'
  | 'engineer'
  | 'estimator'
  | 'procurement'
  | 'warehouse'
  | 'viewer'

export type Module =
  | 'projects'
  | 'volumes'
  | 'boq'
  | 'estimates'
  | 'requests'
  | 'tenders'
  | 'orders'
  | 'deliveries'
  | 'claims'
  | 'admin'

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve'

/**
 * Permission matrix.
 * Each role maps to a set of modules, and each module maps to the allowed actions.
 * A missing module means no access. A missing action means that action is denied.
 */
const permissionMatrix: Record<Role, Partial<Record<Module, Set<Action>>>> = {
  admin: {
    projects: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    volumes: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    boq: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    estimates: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    requests: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    tenders: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    orders: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    deliveries: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    claims: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    admin: new Set(['view', 'create', 'edit', 'delete', 'approve']),
  },

  director: {
    projects: new Set(['view', 'create', 'edit', 'approve']),
    volumes: new Set(['view', 'create', 'edit', 'approve']),
    boq: new Set(['view', 'create', 'edit', 'approve']),
    estimates: new Set(['view', 'create', 'edit', 'approve']),
    requests: new Set(['view', 'create', 'edit', 'approve']),
    tenders: new Set(['view', 'create', 'edit', 'approve']),
    orders: new Set(['view', 'create', 'edit', 'approve']),
    deliveries: new Set(['view', 'create', 'edit', 'approve']),
    claims: new Set(['view', 'create', 'edit', 'approve']),
    admin: new Set(['view']),
  },

  project_manager: {
    projects: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    volumes: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    boq: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    estimates: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    requests: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    tenders: new Set(['view']),
    orders: new Set(['view']),
    deliveries: new Set(['view']),
    claims: new Set(['view']),
  },

  engineer: {
    projects: new Set(['view']),
    volumes: new Set(['view', 'create', 'edit']),
    boq: new Set(['view', 'create', 'edit']),
    estimates: new Set(['view']),
    requests: new Set(['view']),
  },

  estimator: {
    projects: new Set(['view']),
    boq: new Set(['view']),
    estimates: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    requests: new Set(['view', 'create']),
  },

  procurement: {
    requests: new Set(['view']),
    tenders: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    orders: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    deliveries: new Set(['view', 'create', 'edit', 'delete', 'approve']),
    claims: new Set(['view', 'create', 'edit', 'delete', 'approve']),
  },

  warehouse: {
    orders: new Set(['view']),
    deliveries: new Set(['view', 'create', 'edit', 'delete', 'approve']),
  },

  viewer: {
    projects: new Set(['view']),
    volumes: new Set(['view']),
    boq: new Set(['view']),
    estimates: new Set(['view']),
    requests: new Set(['view']),
    tenders: new Set(['view']),
    orders: new Set(['view']),
    deliveries: new Set(['view']),
    claims: new Set(['view']),
    admin: new Set(['view']),
  },
}

/**
 * Check whether a given role has permission to perform an action on a module.
 *
 * @param role    - The user's role
 * @param module  - The target module
 * @param action  - The desired action
 * @returns `true` if the role is permitted, `false` otherwise
 */
export function canAccess(role: Role, module: Module, action: Action): boolean {
  const rolePermissions = permissionMatrix[role]
  if (!rolePermissions) return false

  const moduleActions = rolePermissions[module]
  if (!moduleActions) return false

  return moduleActions.has(action)
}

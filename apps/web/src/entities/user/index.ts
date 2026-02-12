// API
export { useUsers, useUser, useCurrentUser, userKeys } from './api/queries'
export { useCreateUser, useUpdateUser } from './api/mutations'

// Hooks
export { useUsersWithSearch } from './hooks/use-users'

// UI
export { UserAvatar } from './ui/user-avatar'
export { UserSelect } from './ui/user-select'
export { RoleBadge, ROLE_LABELS } from './ui/role-badge'

// Types & schemas
export type {
  User,
  UserWithOrg,
  UserListParams,
  CreateUserInput,
  UpdateUserInput,
  UserRole,
} from './types'
export { createUserSchema, updateUserSchema, USER_ROLES } from './types'

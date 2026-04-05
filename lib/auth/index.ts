export {
  getCurrentUser,
  requireAuth,
  requireAdmin,
  requireRole,
  isAdmin,
  hasRole,
  getUserProfile,
  UnauthorizedError,
  ForbiddenError,
} from './authorization'

export type { UserRole, ProfileRecord } from './authorization'

export { logAuthEvent } from './audit'

export type { AuthEventType, AuthAuditEntry } from './audit'

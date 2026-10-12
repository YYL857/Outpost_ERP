export type { AuthUser, UserRole, UserPrefs } from "./types.js";
export { bootstrapAuth } from "./bootstrap.js";
export { createAuthRouter } from "./auth.routes.js";
export {
  createAuthMiddleware,
  requireAdmin,
  requirePurchaseAccess,
  requireAssigner,
  requireCapability,
  type AuthedRequest,
} from "./middleware.js";
export {
  AGENT_TOOL_CAPABILITY,
  canUseOpsInterpret,
  capabilitiesForRole,
  capabilityForOpsSurface,
  hasCapability,
  roleCapabilitySummary,
  type Capability,
} from "./permissions.js";
export {
  getContextShopId,
  getContextUser,
  getContextUserId,
  getRequestContext,
  requireContextUser,
  runWithContext,
  SYSTEM_SYNC_USER,
} from "./context.js";
export {
  ensureUserWorkspace,
  loadUserFavorites,
  loadUserPrefs,
  resolveWorkspaceUserId,
  saveUserFavorites,
  setSelectedShopId,
  userListingRoot,
  userWatchlistPath,
} from "./workspace.js";
export { getAdminUser, listUsersPublic } from "./users.js";

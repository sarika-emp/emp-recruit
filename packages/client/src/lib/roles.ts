// Single source of truth for Recruit roles on the client. Mirrors the server's
// AuthPayload["role"] union in packages/server/src/api/middleware/auth.middleware.ts.
export type Role = "super_admin" | "org_admin" | "hr_admin" | "hr_manager" | "employee";

// Staff roles that can access the recruiting workspace (jobs, candidates,
// interviews, offers, analytics, settings…). Everything an `employee` cannot do.
export const ADMIN_ROLES: Role[] = ["super_admin", "org_admin", "hr_admin", "hr_manager"];

export function isAdminRole(role?: string | null): boolean {
  return ADMIN_ROLES.includes((role || "employee") as Role);
}

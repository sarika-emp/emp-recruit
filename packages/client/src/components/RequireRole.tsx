import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { getUser } from "@/lib/auth-store";
import { ADMIN_ROLES, type Role } from "@/lib/roles";

/**
 * Route guard for staff-only pages. Renders the nested routes only when the
 * signed-in user's role is allowed; otherwise sends them back to the dashboard
 * with a toast. This is the UI mirror of the server's authorize() checks — the
 * API already returns 403, but without this an employee could open an admin
 * page (e.g. /jobs/new) directly by URL and see a form they can't submit.
 */
export function RequireRole({ roles = ADMIN_ROLES }: { roles?: Role[] }) {
  const location = useLocation();
  const role = (getUser()?.role || "employee") as Role;
  const allowed = roles.includes(role);

  useEffect(() => {
    if (!allowed) {
      toast.error("You don't have access to that page.");
    }
  }, [allowed, location.pathname]);

  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";

export function usePermission() {
  const { user } = useAuth();
  const role: UserRole = user?.role || "viewer";

  return {
    role,
    isAdmin: role === "admin",
    isEditor: role === "editor" || role === "admin",
    isViewer: role === "viewer",
    canCreate: role === "admin" || role === "editor",
    canEdit: role === "admin" || role === "editor",
    canDelete: role === "admin",
    canManageUsers: role === "admin",
    canAccessSettings: role === "admin",
    canImport: role === "admin" || role === "editor",
    canExport: true, // all roles can export
  };
}

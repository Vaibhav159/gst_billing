import { describe, it, expect } from "vitest";

// Test the role logic directly (without React context)
function getPermissions(role: string) {
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
    canExport: true,
  };
}

describe("permission logic", () => {
  it("admin has full access", () => {
    const p = getPermissions("admin");
    expect(p.canCreate).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
    expect(p.canManageUsers).toBe(true);
    expect(p.canAccessSettings).toBe(true);
  });

  it("editor can create and edit but not delete", () => {
    const p = getPermissions("editor");
    expect(p.canCreate).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(false);
    expect(p.canManageUsers).toBe(false);
  });

  it("viewer can only read and export", () => {
    const p = getPermissions("viewer");
    expect(p.canCreate).toBe(false);
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canExport).toBe(true);
    expect(p.isViewer).toBe(true);
  });
});

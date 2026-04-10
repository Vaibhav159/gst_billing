import { useState, useEffect } from "react";
import { Users, Plus, Shield, Pencil, UserCheck, UserX, Loader2 } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/usePermission";
import api from "@/utils/api";

interface UserData {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
}

const ROLE_CONFIG = {
  admin: { label: "Admin", color: "text-destructive", bg: "bg-destructive/12", desc: "Full access" },
  editor: { label: "Editor", color: "text-chart-3", bg: "bg-chart-3/12", desc: "Create & edit" },
  viewer: { label: "Viewer", color: "text-chart-1", bg: "bg-chart-1/12", desc: "Read only" },
};

export default function UserManagement() {
  const { toast } = useToast();
  const { canManageUsers } = usePermission();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", password: "", email: "", first_name: "", last_name: "", role: "editor" });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await api.get("users/");
      setUsers(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Shield className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-lg font-semibold text-foreground">Access Denied</p>
        <p className="text-sm text-muted-foreground">Only admins can manage users.</p>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password) {
      toast({ title: "Missing Fields", description: "Username and password required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await api.post("users/", createForm);
      toast({ title: "User Created", description: `${createForm.username} added as ${createForm.role}` });
      setShowCreate(false);
      setCreateForm({ username: "", password: "", email: "", first_name: "", last_name: "", role: "editor" });
      fetchUsers();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.response?.data?.error || "Could not create user.", variant: "destructive" });
    }
    setCreating(false);
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    try {
      await api.patch("users/", { user_id: userId, role: newRole });
      toast({ title: "Role Updated", description: `Changed to ${newRole}` });
      fetchUsers();
      setEditingId(null);
    } catch (err: any) {
      toast({ title: "Failed", description: err?.response?.data?.error || "Could not update role.", variant: "destructive" });
    }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    try {
      await api.patch("users/", { user_id: userId, is_active: !isActive });
      toast({ title: isActive ? "User Deactivated" : "User Activated" });
      fetchUsers();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto p-6 lg:p-8">
      <Breadcrumbs items={[{ label: "Settings", href: "/billing/settings" }, { label: "User Management" }]} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">User Management</h1>
            <p className="text-sm text-muted-foreground">{users.length} users</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="premium-btn-primary text-[13px]">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      {/* Create User Form */}
      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="elevated-card rounded-2xl p-5 space-y-4">
          <h3 className="text-[13px] font-display font-semibold">Create New User</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={createForm.username} onChange={(e) => setCreateForm(p => ({ ...p, username: e.target.value }))} placeholder="Username *" className="premium-input text-[13px]" />
            <input value={createForm.password} onChange={(e) => setCreateForm(p => ({ ...p, password: e.target.value }))} placeholder="Password *" type="password" className="premium-input text-[13px]" />
            <input value={createForm.first_name} onChange={(e) => setCreateForm(p => ({ ...p, first_name: e.target.value }))} placeholder="First Name" className="premium-input text-[13px]" />
            <input value={createForm.last_name} onChange={(e) => setCreateForm(p => ({ ...p, last_name: e.target.value }))} placeholder="Last Name" className="premium-input text-[13px]" />
            <input value={createForm.email} onChange={(e) => setCreateForm(p => ({ ...p, email: e.target.value }))} placeholder="Email" className="premium-input text-[13px]" />
            <select value={createForm.role} onChange={(e) => setCreateForm(p => ({ ...p, role: e.target.value }))} className="premium-select text-[13px]">
              <option value="admin">Admin — Full access</option>
              <option value="editor">Editor — Create & edit</option>
              <option value="viewer">Viewer — Read only</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="premium-btn-ghost text-[12px]">Cancel</button>
            <button onClick={handleCreate} disabled={creating} className="premium-btn-primary text-[12px]">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>
        </motion.div>
      )}

      {/* Users Table */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <table className="table-premium text-[13px]">
            <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const rc = ROLE_CONFIG[u.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.viewer;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-[11px] font-bold">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{u.full_name}</p>
                          <p className="text-[10px] text-muted-foreground">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground">{u.email || "-"}</td>
                    <td>
                      {editingId === u.id ? (
                        <select defaultValue={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)} onBlur={() => setEditingId(null)} autoFocus
                          className="premium-select text-[11px] w-24">
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className={cn("premium-badge text-[10px]", rc.bg, rc.color)}>{rc.label}</span>
                      )}
                    </td>
                    <td>
                      <span className={cn("premium-badge text-[10px]", u.is_active ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="text-muted-foreground text-[11px]">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never"}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingId(u.id)} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors" title="Change role">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleToggleActive(u.id, u.is_active)} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors" title={u.is_active ? "Deactivate" : "Activate"}>
                          {u.is_active ? <UserX className="w-3.5 h-3.5 hover:text-destructive" /> : <UserCheck className="w-3.5 h-3.5 hover:text-success" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Role Legend */}
      <div className="elevated-card rounded-2xl p-5">
        <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Role Permissions</h3>
        <div className="grid grid-cols-3 gap-4 text-[12px]">
          {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
            <div key={key} className="space-y-1">
              <span className={cn("premium-badge text-[10px]", cfg.bg, cfg.color)}>{cfg.label}</span>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 mt-1">
                {key === "admin" && <><li>Create, edit, delete</li><li>Settings & user management</li><li>Import & export</li></>}
                {key === "editor" && <><li>Create & edit records</li><li>Import data</li><li>Cannot delete or manage users</li></>}
                {key === "viewer" && <><li>View all data</li><li>Export & print</li><li>Cannot create, edit, or delete</li></>}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

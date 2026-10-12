import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { ROLES } from "@/core/auth/permissions";
import type { Role } from "@/core/auth/role";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { Avatar, Button, Card, ConfirmDialog, DL } from "@/core/ui";

export type EasyProfile = {
  username: string; first_name: string; last_name: string; role: Role; role_label: string;
  usual_firm: { id: number; name: string; short: string } | null; sms_reset: boolean;
};
export type ProfileBodyProps = {
  person: EasyProfile; firm: { id: number; name: string } | null; dirty: boolean;
  passwordForm: ReactNode; signOut: () => void | Promise<void>;
};
export function ProfileBody({ person, firm, dirty, passwordForm, signOut }: ProfileBodyProps) {
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const guard = useUnsavedGuard(dirty && !busy, "Your new password isn't saved. Leave and lose it?");
  const name = `${person.first_name} ${person.last_name}`.trim() || person.username;
  const logout = async () => {
    if (busy) return;
    setBusy(true); setProblem("");
    try { await signOut(); if (mounted.current) setLeaving(false); }
    catch (error) { if (mounted.current) setProblem(problemOf(error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <>
    {guard}
    <Card>
      <div className="flex items-center gap-4">
        <Avatar name={name} size={56} />
        <div className="min-w-0"><p className="text-xl font-semibold truncate">{name}</p><p className="text-md text-muted">@{person.username}</p></div>
      </div>
      <DL className="mt-4" rows={[
        ["Role", person.role_label], ["Usually works for", person.usual_firm?.name || "—"],
        person.usual_firm && firm && firm.id !== person.usual_firm.id ? ["On this phone", firm.name] : null,
      ]} />
      <p className="text-md text-muted mt-2">{ROLES[person.role].blurb} Only the owner changes roles and names.</p>
    </Card>
    <section aria-labelledby="ep-t" className="card p-4 flex flex-col gap-4">
      <div><h2 id="ep-t" className="text-lg font-semibold">Change password</h2><p className="text-md text-muted">It works from the next time you sign in.</p></div>
      {passwordForm}
      <p className="text-md text-muted">Forgot your password? {person.sms_reset
        ? "On the sign-in page, tap Forgot your password? to see how to get a code."
        : "Password codes by SMS aren't switched on yet. Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app."}</p>
    </section>
    <Button variant="danger-outline" size="lg" icon={LogOut} full onClick={() => setLeaving(true)}>Log out of this phone</Button>
    <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} onConfirm={() => void logout()} busy={busy} tone="danger"
      title="Log out of this phone?" confirmLabel="Log out" cancelLabel="Stay signed in">
      <p>You'll need your password to sign in again.</p>
      {problem ? <p role="alert" className="text-neg">{problem}</p> : null}
    </ConfirmDialog>
  </>;
}

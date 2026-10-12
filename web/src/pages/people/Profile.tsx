import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Check, Laptop, LogOut, UserRound } from "lucide-react";
import { useProfile, useSaveProfile, useSessions, useSignOutSession, useSignOutOthers, type AccountProfile, type Session } from "@/core/api/account";
import { problemOf, saveFailure, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { ROLES } from "@/core/auth/permissions";
import { date } from "@/core/format";
import { emailProblem, mobileDigits, mobileProblem } from "@/core/ids";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { dayOf, timeOf } from "@/core/sales/words";
import { useView } from "@/core/view";
import { Avatar, Badge, Button, Card, ConfirmDialog, FailNote, Field, Input, Page, QueryView, cn } from "@/core/ui";
import { ChangePasswordForm } from "./PasswordFields";

const when = (value: string) => `${date(dayOf(value))}, ${timeOf(value)}`;
export default function Profile() {
  const query = useProfile();
  return <Page narrow icon={UserRound} title="Profile and password" back="/more" context={query.data ? `${query.data.first_name} ${query.data.last_name} · @${query.data.username} · ${query.data.role_label}` : undefined} phoneSubtitle={query.data ? `@${query.data.username} · ${query.data.role_label}` : undefined}>
    <QueryView query={query} what="your profile">{(person) => <ProfileBody key={person.id} person={person} />}</QueryView>
  </Page>;
}
function ProfileBody({ person }: { person: AccountProfile }) {
  const { isPhone } = useView();
  const { refreshMe } = useAuth();
  const save = useSaveProfile();
  const [first, setFirst] = useState(person.first_name);
  const [last, setLast] = useState(person.last_name);
  const [email, setEmail] = useState(person.email);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [current, setCurrent] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const phoneChanged = person.phone_allowed && mobileDigits(phone) !== (person.phone ?? "");
  const changed = first.trim() !== person.first_name || last.trim() !== person.last_name || email.trim() !== person.email || phoneChanged;
  const guard = useUnsavedGuard(changed || passwordDirty, "Your password or details aren't saved. Leave and lose them?");
  const errors = {
    first_name: !first.trim() ? "Enter your first name. It shows in the Audit log next to your changes." : "",
    email: emailProblem(email), phone: person.phone_allowed ? mobileProblem(phone) : "",
    current: phoneChanged && !current ? "Enter your current password." : "",
  };
  const err = (key: keyof typeof errors) => problem?.fields?.[key] || (tried ? errors[key] : "");
  const edited = () => { setProblem(null); setSaved(false); setRefreshFailed(false); };
  const saveDetails = async (event?: FormEvent) => {
    event?.preventDefault(); if (busy) return;
    setTried(true); setProblem(null);
    const bad = (Object.keys(errors) as (keyof typeof errors)[]).find((key) => errors[key]);
    if (bad) { document.getElementById(`pf-${bad}`)?.focus(); return; }
    setBusy(true);
    try {
      await save.mutateAsync({ first_name: first.trim(), last_name: last.trim(), email: email.trim(), ...(person.phone_allowed ? { phone: mobileDigits(phone) } : {}), ...(phoneChanged ? { current } : {}) });
      setCurrent("");
      setSaved(true); setTried(false);
      try { await refreshMe(); } catch { setRefreshFailed(true); }
    } catch (error) {
      const failure = problemOf(error); setProblem(failure);
      const field = Object.keys(failure.fields ?? {})[0];
      if (field) document.getElementById(`pf-${field}`)?.focus();
    } finally { setBusy(false); }
  };
  const grid2 = cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2");
  const name = `${person.first_name} ${person.last_name}`.trim();
  return <>
    {guard}
    <Card title="You" actions={saved ? <span role="status" className="inline-flex items-center gap-1 text-sm font-medium text-sale whitespace-nowrap anim-rise"><Check size={14} aria-hidden="true" />Saved</span> : undefined}>
      <form onSubmit={(event) => { void saveDetails(event); }} noValidate className="flex flex-col gap-5">
        <div className="flex items-center gap-4"><Avatar name={name} size={52} /><div className="min-w-0">
          <p className="text-lg font-semibold truncate">{name}</p>
          <p className="text-sm text-muted">@{person.username} · usually works for {person.usual_firm?.short ?? "the shop's default"}; change it in <Link to="/settings" className="link">Settings › You</Link></p>
        </div></div>
        <div className={grid2}>
          <Field label="First name" htmlFor="pf-first_name" required error={err("first_name")}>
            <Input id="pf-first_name" value={first} onChange={(event) => { setFirst(event.target.value); edited(); }} autoComplete="given-name" readOnly={busy} />
          </Field>
          <Field label="Last name" htmlFor="pf-last_name" hint="Optional" error={problem?.fields?.last_name}>
            <Input id="pf-last_name" value={last} onChange={(event) => { setLast(event.target.value); edited(); }} autoComplete="family-name" readOnly={busy} />
          </Field>
          <Field label="Email" htmlFor="pf-email" error={err("email")} hint="Optional. For the backup reminder." className={isPhone ? "" : "col-span-2"}>
            <Input id="pf-email" type="email" inputMode="email" value={email} onChange={(event) => { setEmail(event.target.value); edited(); }} autoComplete="email" readOnly={busy} />
          </Field>
          {person.phone_allowed ? <Field label="Mobile number" htmlFor="pf-phone" hint={person.sms_reset ? "Password codes are sent to this number." : "Codes are sent once SMS is switched on"} error={err("phone")} className={isPhone ? "" : "col-span-2"}>
            <Input id="pf-phone" type="tel" inputMode="tel" value={phone} onChange={(event) => { setPhone(event.target.value); edited(); }} autoComplete="tel-national" readOnly={busy} />
          </Field> : null}
          {phoneChanged ? <Field label="Current password" htmlFor="pf-current" error={err("current")} hint="Changing your mobile number signs out your other devices." className={isPhone ? "" : "col-span-2"}>
            <Input id="pf-current" type="password" value={current} onChange={(event) => { setCurrent(event.target.value); edited(); }} autoComplete="current-password" readOnly={busy} />
          </Field> : null}
        </div>
        <FailNote error={problem && !problem.fields ? saveFailure(problem) : null} onRetry={() => { void saveDetails(); }} busy={busy} />
        {refreshFailed ? <p role="status" className="text-sm text-muted">Details saved. Your name in the app couldn't refresh; reload when the connection is back.</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!changed} loading={busy} onMouseDown={(event) => event.preventDefault()} className={isPhone ? "w-full" : ""}>{busy ? "Saving…" : "Save details"}</Button>
          <span className="text-sm text-muted">Your name shows in the Audit log next to everything you change.</span>
        </div>
        <div className={grid2}>
          <Field label="Username" htmlFor="pf-user" hint="You sign in with it."><Input id="pf-user" value={`@${person.username}`} disabled /></Field>
          <div className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg2">Role</span>
            <span className="min-h-11 flex items-center gap-2"><Badge>{person.role_label}</Badge><span className="text-sm text-muted">{person.role === "owner" ? "Another owner can change your role" : "Only the owner changes roles"}</span></span>
            <span className="text-sm text-muted">{ROLES[person.role].blurb}</span>
          </div>
        </div>
      </form>
    </Card>
    <Card title="Change password" subtitle="Your other devices are signed out when you change it">
      <ChangePasswordForm person={person} onDirty={setPasswordDirty} />
      <p className="text-sm text-muted mt-4">Forgot your current password? {person.role === "owner" ? "Sign out and use “Forgot password” on the sign-in page." : "Ask the owner to set a new one from Users and roles."}</p>
    </Card>
    <Sessions />
  </>;
}
function Sessions() {
  const query = useSessions();
  return <QueryView query={query} what="signed-in devices">{({ results }) => <SessionList devices={results} />}</QueryView>;
}
function SessionList({ devices }: { devices: Session[] }) {
  const { isPhone } = useView();
  const { signOut } = useAuth();
  const signOutOne = useSignOutSession();
  const signOutOthers = useSignOutOthers();
  const [confirm, setConfirm] = useState<Session | "all" | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [selfProblem, setSelfProblem] = useState<ApiProblem | null>(null);
  const [selfBusy, setSelfBusy] = useState(false);
  const others = devices.filter((device) => !device.current);
  const busy = signOutOne.isPending || signOutOthers.isPending;
  const revoke = async () => {
    if (!confirm || busy) return;
    setProblem(null);
    try { if (confirm === "all") await signOutOthers.mutateAsync(); else await signOutOne.mutateAsync(confirm.id); setConfirm(null); }
    catch (error) { setProblem(problemOf(error)); }
  };
  const leave = async () => {
    if (selfBusy) return;
    setSelfBusy(true); setSelfProblem(null);
    try { await signOut(); } catch (error) { setSelfProblem(problemOf(error)); } finally { setSelfBusy(false); }
  };
  return <>
    <Card title="Signed-in devices" subtitle={`${devices.length} ${devices.length === 1 ? "device" : "devices"} · signing one out asks for the password there next time`} pad={false}
      actions={others.length > 0 ? <Button size="sm" variant="danger-outline" icon={LogOut} onClick={() => { setConfirm("all"); setProblem(null); }}>Sign out all others</Button> : null}>
      <ul className="mt-2">{devices.map((device) => <li key={device.id} className={cn("flex items-center gap-3 border-t border-rule", isPhone ? "px-4 py-3" : "px-5 py-3")}>
        <span className="w-10 h-10 rounded-ctl bg-raised grid place-items-center text-fg2 shrink-0"><Laptop size={20} aria-hidden="true" /></span>
        <span className="flex-1 min-w-0"><span className="flex items-center gap-2"><span className="font-medium truncate">{device.device}</span>{device.current ? <Badge tone="sale" icon={Check}>This device</Badge> : null}</span>
          <span className="block text-sm text-muted truncate">Last used {when(device.last_used_at)}</span>
        </span>
        {device.current ? <Button size="sm" variant="ghost" icon={LogOut} loading={selfBusy} onClick={() => { void leave(); }}>Sign out</Button>
          : <Button size="sm" variant="danger-outline" onClick={() => { setConfirm(device); setProblem(null); }} aria-label={`Sign out on ${device.device}`}>Sign out</Button>}
      </li>)}</ul>
      {!others.length ? <p className="px-5 py-4 text-sm text-muted border-t border-rule">You're signed in on this device only.</p> : null}
      <FailNote error={selfProblem ? { title: "Not signed out", body: selfProblem.message } : null} onRetry={() => { void leave(); }} busy={selfBusy} className="m-4" />
    </Card>
    <ConfirmDialog open={Boolean(confirm)} busy={busy} busyLabel="Signing out…" onClose={() => { setConfirm(null); setProblem(null); }} tone="danger"
      title={confirm === "all" ? `Sign out on ${others.length} other devices?` : confirm ? `Sign out on ${confirm.device}?` : ""}
      confirmLabel={confirm === "all" ? `Sign out ${others.length} devices` : "Sign out"} onConfirm={() => { void revoke(); }}
      record={confirm === "all" ? others.map((device) => ["Device", device.device] as const) : confirm ? [["Device", confirm.device], ["Last used", when(confirm.last_used_at)]] : null}
      extra={<FailNote error={problem ? { title: "Not signed out", body: problem.message } : null} />}>
      <p>Whoever uses {confirm === "all" ? "them" : "it"} next has to sign in with your password. Anything being typed there that isn't saved is lost. Recorded in the Audit log.</p>
    </ConfirmDialog>
  </>;
}

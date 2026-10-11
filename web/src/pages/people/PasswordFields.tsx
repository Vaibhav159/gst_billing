import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { useChangePassword, type PasswordAnswer } from "@/core/api/account";
import { problemOf, saveFailure, type ApiProblem } from "@/core/api/errors";
import { PasswordChangedElsewhere, useAuth } from "@/core/auth/AuthProvider";
import { timeOf } from "@/core/sales/words";
import { useView } from "@/core/view";
import { Button, Field, Input, FailNote, SuccessMark, cn } from "@/core/ui";

export type PasswordIdentity = { username: string; first_name: string; last_name: string };
function rules(value: string, identity: PasswordIdentity, own: boolean, current?: string) {
  const names = [identity.username, identity.first_name, identity.last_name].map((name) => name.trim()).filter((name) => [...name].length >= 3);
  return [
    { text: "At least 8 characters", ok: [...value].length >= 8 },
    { text: "Letters and at least one number", ok: /\p{L}/u.test(value) && /\p{N}/u.test(value) },
    { text: own ? "Not your name or username" : "Not the person's name or username", ok: Boolean(value) && names.every((name) => !value.toLowerCase().includes(name.toLowerCase())) },
    ...(current === undefined ? [] : [{ text: "Different from your current password", ok: Boolean(value) && value !== current }]),
  ];
}
/** The common-password list belongs to the server; never mark that rule passed locally. */
export function passwordError(value: string, identity: PasswordIdentity, own = false, current?: string): string {
  const missing = rules(value, identity, own, current).filter((rule) => !rule.ok);
  return missing.length ? `${own ? "The new password needs" : "It needs"}: ${missing.map((rule) => rule.text.toLowerCase()).join("; ")}.` : "";
}
export function newPasswordValid(value: string, again: string, identity: PasswordIdentity, own = false): boolean {
  return !passwordError(value, identity, own) && value === again;
}
export function PasswordRules({ id, password, identity, own = false, current }: { id: string; password: string; identity: PasswordIdentity; own?: boolean; current?: string }) {
  const { isPhone } = useView();
  const checks = rules(password, identity, own, current);
  checks.splice(3, 0, { text: "Not a common password", ok: false });
  return <ul id={id} className={cn("grid gap-1.5", isPhone ? "grid-cols-1" : "grid-cols-2")} aria-label="Password rules">
    {checks.map((rule) => <li key={rule.text} className={cn("flex items-center gap-2 text-sm transition-colors", rule.ok ? "text-sale" : "text-muted")}>
      {rule.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
      {rule.text}{rule.text === "Not a common password" ? " · checked when saved" : <span className="sr-only">{rule.ok ? ": done" : ": not yet"}</span>}
    </li>)}
  </ul>;
}

export type PasswordFieldsProps = {
  id: string; value: string; onChange: (value: string) => void; again: string; onAgain: (value: string) => void;
  identity: PasswordIdentity; tried?: boolean; own?: boolean; error?: string; againError?: string; current?: string; disabled?: boolean; onVisibilityChange?: (show: boolean) => void;
};
export function PasswordFields({ id, value, onChange, again, onAgain, identity, tried, own = false, error, againError, current, disabled, onVisibilityChange }: PasswordFieldsProps) {
  const [show, setShow] = useState(false);
  const { isPhone } = useView();
  const problem = error || (tried ? !value ? own ? "Choose a new password." : "Set a password for them." : passwordError(value, identity, own, current) : "");
  const repeated = againError || (tried ? !again && own ? "Type the new password again." : again !== value || !again ? own ? "The two new passwords don't match. Type it again carefully." : "The two passwords don't match. Type it again." : "" : "");
  return <>
    <div className={cn("grid gap-4", isPhone || !own ? "grid-cols-1" : "grid-cols-2")}>
      <Field label={own ? "New password" : "Password"} htmlFor={`${id}-password`} error={problem}>
        <Input id={`${id}-password`} type={show ? "text" : "password"} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} readOnly={disabled} aria-describedby={`${id}-rules${problem ? ` ${id}-password-error` : ""}`} />
      </Field>
      <Field label={own ? "New password again" : "Password again"} htmlFor={`${id}-again`} error={repeated}>
        <Input id={`${id}-again`} type={show ? "text" : "password"} autoComplete="new-password" value={again} onChange={(event) => onAgain(event.target.value)} readOnly={disabled} />
      </Field>
    </div>
    <PasswordRules id={`${id}-rules`} password={value} identity={identity} own={own} current={current} />
    <Button variant="ghost" icon={show ? EyeOff : Eye} onClick={() => { setShow(!show); onVisibilityChange?.(!show); }} aria-pressed={show} className="self-start">{show ? "Hide passwords" : "Show passwords"}</Button>
  </>;
}

const ELSEWHERE = "This tab signed in differently while the password was saving. If you are asked to sign in, use your new password.";

/** Shared by Profile and the mandatory password page; fields live only in this form's memory. */
export function ChangePasswordForm({ person, onDirty, forced = false, onChanged }: { person: PasswordIdentity; onDirty?: (dirty: boolean) => void; forced?: boolean; onChanged?: () => void }) {
  const change = useChangePassword();
  const { acceptPasswordChange } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [success, setSuccess] = useState<{ detail: string; at: string } | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty?.(Boolean(current || password || again)); }, [current, password, again, onDirty]);
  const currentError = problem?.fields?.current || (tried && !current ? "Enter your current password." : "");
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setTried(true); setProblem(null);
    const bad = !current ? "current" : passwordError(password, person, true, current) ? "password" : password !== again ? "again" : null;
    if (bad) { document.getElementById(`pw-${bad}`)?.focus(); return; }
    setBusy(true);
    let reply: PasswordAnswer | null = null;
    try {
      reply = await change.mutateAsync({ current, password });
      await acceptPasswordChange(reply);
      if (!mounted.current) return;
      setSuccess({ detail: reply.detail, at: reply.changed_at }); setCurrent(""); setPassword(""); setAgain(""); setTried(false);
      change.reset(); if (mounted.current) onChanged?.();
    } catch (error) {
      if (!mounted.current) return;
      // Saved on the server, but this tab is now signed in differently: say so, and never offer to send the old password again.
      if (reply && error instanceof PasswordChangedElsewhere) {
        setSuccess({ detail: ELSEWHERE, at: reply.changed_at }); setCurrent(""); setPassword(""); setAgain(""); setTried(false);
        return;
      }
      const failure = problemOf(error); setProblem(failure);
      document.getElementById(failure.fields?.current ? "pw-current" : "pw-password")?.focus();
    } finally { setBusy(false); }
  };
  return <form onSubmit={(event) => { void submit(event); }} noValidate className="flex flex-col gap-4">
    {success ? <div role="status" className="flex items-center gap-3 rounded-ctl border border-sale-line bg-sale-tint px-4 py-3 anim-rise"><SuccessMark size={36} /><span><span className="block font-medium">Password changed at {timeOf(success.at)}</span><span className="block text-sm text-fg2">{success.detail}</span></span></div> : null}
    <Field label="Current password" htmlFor="pw-current" error={currentError}>
      <Input id="pw-current" type={show ? "text" : "password"} autoComplete="current-password" value={current} onChange={(event) => { setCurrent(event.target.value); setProblem(null); setSuccess(null); }} readOnly={busy} />
    </Field>
    <PasswordFields id="pw" identity={person} own current={current} value={password} again={again} tried={tried} error={problem?.fields?.password} disabled={busy} onVisibilityChange={setShow}
      onChange={(value) => { setPassword(value); setProblem(null); setSuccess(null); }} onAgain={(value) => { setAgain(value); setProblem(null); setSuccess(null); }} />
    <FailNote error={problem && !problem.fields ? saveFailure(problem) : null} onRetry={() => { void submit(); }} busy={busy} />
    <Button type="submit" variant="primary" icon={KeyRound} loading={busy} className="self-start">{busy ? "Changing…" : forced ? "Save my password" : "Change password"}</Button>
  </form>;
}

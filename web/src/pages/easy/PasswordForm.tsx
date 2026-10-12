import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { useChangePassword, type PasswordAnswer } from "@/core/api/account";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { PasswordChangedElsewhere, useAuth } from "@/core/auth/AuthProvider";
import { timeOf } from "@/core/sales/words";
import { Button, Field, Input, SuccessMark } from "@/core/ui";
import { PasswordFields, passwordError, type PasswordIdentity } from "@/pages/people/PasswordFields";

export function EasyPasswordForm({ person, onDirty }: { person: PasswordIdentity; onDirty: (dirty: boolean) => void }) {
  const change = useChangePassword();
  const { acceptPasswordChange } = useAuth();
  const [pw, setPw] = useState({ current: "", password: "", again: "" });
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [success, setSuccess] = useState<{ at: string; detail: string } | null>(null);
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(Boolean(pw.current || pw.password || pw.again)); }, [pw, onDirty]);
  const currentError = problem?.fields?.current || (tried && !pw.current ? "Enter your current password." : "");
  const edit = (field: keyof typeof pw, value: string) => { setPw((previous) => ({ ...previous, [field]: value })); setProblem(null); setSuccess(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    setTried(true); setProblem(null);
    const bad = !pw.current ? "current" : !pw.password || passwordError(pw.password, person, true, pw.current) ? "password" : !pw.again || pw.password !== pw.again ? "again" : null;
    if (bad) { document.getElementById(`ep-${bad}`)?.focus(); return; }
    if (!navigator.onLine) { setProblem({ kind: "offline", message: "You're offline" }); return; }
    saving.current = true; setBusy(true);
    let reply: PasswordAnswer | null = null;
    try {
      reply = await change.mutateAsync({ current: pw.current, password: pw.password });
      // This is 4D's only token adoption path: it keeps both tokens, protects a newer sign-in and reads me/ with the new access token.
      await acceptPasswordChange(reply);
      if (!mounted.current) return;
      setSuccess({ at: reply.changed_at, detail: reply.detail }); setPw({ current: "", password: "", again: "" }); setTried(false); change.reset();
    } catch (error) {
      if (!mounted.current) return;
      // The server saved it; a newer sign-in must keep its tokens and must not retry the old password.
      if (reply && error instanceof PasswordChangedElsewhere) {
        setSuccess({ at: reply.changed_at, detail: "This tab signed in differently while the password was saving. If you are asked to sign in, use your new password." });
        setPw({ current: "", password: "", again: "" }); setTried(false); change.reset();
        return;
      }
      const failure = problemOf(error); setProblem(failure);
      document.getElementById(failure.fields?.current ? "ep-current" : "ep-password")?.focus();
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return <>
    {success ? <div role="status" className="flex items-center gap-3 rounded-ctl border border-sale-line bg-sale-tint px-4 py-3 anim-rise">
      <SuccessMark size={40} /><span><span className="block font-medium">Password changed at <time dateTime={success.at}>{timeOf(success.at)}</time></span>
        <span className="block text-md text-fg2">{success.detail}</span></span>
    </div> : null}
    {problem && !problem.fields ? <p role="alert" className="text-neg">{problem.kind === "offline"
      ? "Not changed yet: you're offline. Your old password still works."
      : problem.message}</p> : null}
    <form id="ep-form" onSubmit={(event) => { void submit(event); }} noValidate className="flex flex-col gap-4">
      <Field label="Current password" htmlFor="ep-current" error={currentError}>
        <Input id="ep-current" type={show ? "text" : "password"} autoComplete="current-password" value={pw.current} readOnly={busy} onChange={(event) => edit("current", event.target.value)} />
      </Field>
      <PasswordFields id="ep" identity={person} own current={pw.current} value={pw.password} again={pw.again} tried={tried}
        error={problem?.fields?.password} disabled={busy} onVisibilityChange={setShow}
        onChange={(value) => edit("password", value)} onAgain={(value) => edit("again", value)} />
      <Button type="submit" variant="primary" size="xl" icon={KeyRound} full loading={busy}>{busy ? "Changing…" : "Change password"}</Button>
    </form>
  </>;
}

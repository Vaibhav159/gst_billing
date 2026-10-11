import { useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { Smartphone, UserRound } from "lucide-react";
import { useAuthOptions, startReset, finishReset, usePrivateMutation, SMS_OFF } from "@/core/api/auth";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { Button, Dialog, Field, Input, QueryView } from "@/core/ui";
import { PasswordFields, newPasswordValid } from "./PasswordFields";

export default function ForgotPassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const options = useAuthOptions();
  const send = usePrivateMutation(startReset);
  const reset = usePrivateMutation(finishReset);
  const [step, setStep] = useState<"pick" | "owner" | "code" | "done">("pick");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [tried, setTried] = useState(false);
  const identity = { username: username.trim(), first_name: "", last_name: "" };
  const busy = send.isPending || reset.isPending;
  const detail = (problem?.body as { detail?: unknown } | undefined)?.detail;
  const words = problem?.code === "sms_failed" && typeof detail === "string" ? detail : problem?.message;
  // `code` is a field-error list here, not the API's machine-readable error code.
  const codeWords = (problem?.body as { code?: unknown } | undefined)?.code;
  const codeError = Array.isArray(codeWords) ? codeWords.filter((w): w is string => typeof w === "string").join(" ") : step === "code" && tried && !/^\d{6}$/.test(code) ? "The code has 6 digits. Check the SMS." : "";
  const usernameError = tried && !username.trim() ? "Enter your username." : problem?.fields?.username;
  useEffect(() => { if (step === "owner" || step === "code") document.getElementById(step === "owner" ? "fp-user" : "fp-code")?.focus(); }, [step]);
  useLayoutEffect(() => {
    if (!problem) return;
    document.getElementById(Array.isArray(codeWords) ? "fp-code" : problem.fields?.password ? "fp-password" : "fp-user")?.focus();
  }, [problem, codeWords]);
  const clearError = () => setProblem(null);
  const sendCode = async () => {
    setTried(step === "owner"); clearError();
    if (!username.trim()) { document.getElementById("fp-user")?.focus(); return; }
    if (busy) return;
    try {
      const result = await send.mutateAsync(username.trim());
      setMessage(result.detail); setCode(""); setStep("code"); setTried(false);
    } catch (error) { setProblem(problemOf(error)); }
  };
  const finish = async (event: FormEvent) => {
    event.preventDefault(); setTried(true); clearError();
    if (!/^\d{6}$/.test(code)) { document.getElementById("fp-code")?.focus(); return; }
    if (!newPasswordValid(password, again, identity, true)) { document.getElementById(password !== again ? "fp-again" : "fp-password")?.focus(); return; }
    if (busy) return;
    try {
      const result = await reset.mutateAsync({ username: username.trim(), code, password });
      setCode(""); setPassword(""); setAgain(""); setMessage(result.detail); setStep("done"); setTried(false);
    } catch (error) { setProblem(problemOf(error)); }
  };
  const close = () => { if (!busy) onClose(); };
  // hidden unless the server plainly says SMS is on
  const off = options.data?.sms_reset !== true || problem?.code === "sms_off";
  // the username field is only on the owner step; a refusal naming it elsewhere goes in the alert
  const fieldHere = step === "owner" ? usernameError : "";
  const alertWords = step !== "owner" && problem?.fields?.username ? problem.fields.username : words;
  return <Dialog open={open} onClose={close} title="Forgot your password?" size="sm" ghostGuardKey={step}
    footer={<Button onClick={close} disabled={busy}>{step === "done" ? "Back to sign in" : "Close"}</Button>}>
    <QueryView query={options} what="password help">{() => off ? <p className="text-fg2">{SMS_OFF}</p> : <div className="flex flex-col gap-4" aria-busy={busy || undefined}>
      {problem && !codeError && !problem.fields?.password && !fieldHere ? <p role="alert" className="text-neg">{alertWords}</p> : null}
      {step === "pick" ? <div className="flex flex-col gap-3">
        <p className="text-fg2">Who are you?</p>
        <div className="flex items-start gap-3 rounded-card border border-line px-4 py-3">
          <UserRound size={20} className="text-brand mt-0.5 shrink-0" aria-hidden="true" />
          <span><span className="block font-semibold">Staff, accountant or family</span><span className="block text-sm text-fg2 mt-0.5">The owner sets a new password for you in Users and roles. Ask them; it takes a minute.</span></span>
        </div>
        <button type="button" onClick={() => setStep("owner")} className="flex items-start gap-3 text-left rounded-card border border-line px-4 py-3 hover:border-muted/60 transition-colors">
          <Smartphone size={20} className="text-brand mt-0.5 shrink-0" aria-hidden="true" />
          <span><span className="block font-semibold">The owner</span><span className="block text-sm text-fg2 mt-0.5">Get a code by SMS on the number saved in your profile, and choose a new password.</span></span>
        </button>
      </div> : step === "owner" ? <form onSubmit={(e) => { e.preventDefault(); void sendCode(); }} noValidate className="flex flex-col gap-4">
        <Field label="Username" htmlFor="fp-user" error={usernameError}><Input id="fp-user" value={username} onChange={(e) => { setUsername(e.target.value); clearError(); }} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} /></Field>
        <Button type="submit" variant="primary" loading={busy}>Send a code</Button>
        <Button disabled={busy} onClick={() => { setStep("pick"); setTried(false); clearError(); }}>Back</Button>
      </form> : step === "code" ? <form onSubmit={(e) => void finish(e)} noValidate className="flex flex-col gap-4">
        <p role="status" className="text-fg2">{message}</p>
        <Field label="Code from the SMS" htmlFor="fp-code" error={codeError}><Input id="fp-code" inputMode="numeric" autoComplete="one-time-code" value={code} disabled={busy} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); clearError(); }} /></Field>
        <PasswordFields id="fp" value={password} onChange={(v) => { setPassword(v); clearError(); }} again={again} onAgain={(v) => { setAgain(v); clearError(); }} identity={identity} tried={tried} own error={problem?.fields?.password} disabled={busy} />
        <Button type="submit" variant="primary" loading={reset.isPending} disabled={send.isPending}>Set the new password</Button>
        <Button disabled={busy} onClick={() => void sendCode()}>Send a new code</Button>
        <Button disabled={busy} onClick={() => { setStep("owner"); setCode(""); setPassword(""); setAgain(""); setTried(false); clearError(); }}>Back</Button>
      </form> : <p role="status" className="text-fg2">{message}</p>}
    </div>}</QueryView>
  </Dialog>;
}

// Sign in. No marketing badges: the page says what it is and how to get help,
// shows progress, explains each failure in plain words next to the field that
// caused it, and after a session runs out takes the person back to their page.
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Eye, EyeOff, LogIn, WifiOff, CloudOff, KeyRound, Clock, type LucideIcon } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import type { ApiProblem } from "@/core/api/errors";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { AppMark, Button, Field, Input, Banner, Checkbox, Dialog, useDocTitle } from "@/core/ui";
import { version as APP_VERSION } from "../../../package.json";

const loadForgot = () => import("@/pages/people/ForgotPassword");
const ForgotPassword = lazy(loadForgot);

/**
 * Password help's code didn't load (offline, or a stale tab after a release). The sign-in page stays, and today's way
 * is still told: the owner sets a new password. Try again loads it afresh.
 */
function ForgotUnavailable({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Forgot your password?" size="sm" footer={<><Button onClick={onRetry}>Try again</Button><Button onClick={onClose}>Close</Button></>}>
      <p className="text-fg2">The owner sets a new password for you in Users and roles. Ask them; it takes a minute. If you're the owner, ask the person who looks after the app to reset it.</p>
      <p className="text-sm text-muted mt-2">Password help couldn't load. Check the connection, then try again.</p>
    </Dialog>
  );
}
class ForgotBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** What's wrong: a missing field says so under it; a sign-in that didn't go through has a title and an icon, above the fields. */
type Problem = { field?: "user" | "pw"; icon?: LucideIcon; title?: string; text: string };

/** The prototype's words for each way a sign-in fails. */
function failureOf(p: ApiProblem): Problem {
  if (p.code === "stopped") {
    const detail = (p.body as { detail?: unknown } | undefined)?.detail;
    return { icon: KeyRound, title: "Sign-in stopped", text: typeof detail === "string" ? detail : p.message };
  }
  if (p.kind === "auth") return { field: "pw", icon: KeyRound, title: "That username and password don't match", text: "Check both, including capital letters." };
  if (p.kind === "offline") return { icon: WifiOff, title: "You're offline", text: "This phone or computer isn't connected. Check the internet, then sign in again." };
  if (p.kind === "throttled") return { icon: Clock, title: "Too many tries", text: "Wait a minute, then try again." };
  return { icon: CloudOff, title: "The app couldn't get through", text: "It's probably restarting after an update. Wait a minute and try again." };
}

/**
 * Where `next` may send the person after signing in: a page of this app, never another site. Browsers read
 * "/\host" and "/<tab>/host" as "//host", so the path must also resolve to this origin (React Router throws otherwise).
 * Never either authentication page again, however it's spelt (the router reads "/login//" and "/%6Cogin" as this page):
 * the page leaves once, so a signed-in person would be left on it. A path whose %-escapes don't read goes home.
 */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin && !/^\/(login|password)\/*$/i.test(decodeURIComponent(url.pathname)) ? next : null;
  } catch { return null; }
}

export default function Login() {
  const { isPhone, isEasy } = useView();
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(true);
  const [err, setErr] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(query.get("forgot") === "1");
  // a fresh lazy page on Try again: React keeps a failed load as failed
  const [ForgotPage, setForgotPage] = useState(() => ForgotPassword);
  const [forgotTry, setForgotTry] = useState(0);
  const userRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  /** Set once the page has sent the person on: a later signal (this tab's own sign-in coming back late) mustn't move them again. */
  const left = useRef(false);
  useDocTitle("Sign in");
  const expired = query.get("reason") === "expired";
  // back to where the session ran out (a bill being made), else the start
  const next = safeNext(query.get("next")) || "/";
  const goOn = () => {
    if (left.current) return;
    left.current = true;
    navigate(next, { replace: true });
  };
  useEffect(() => { if (!isPhone) userRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // tabs share one sign-in: signed in on another tab (or already), go on as after signing in here
  useEffect(() => { if (status === "signed-in") goOn(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  // the field at fault takes the cursor, its text selected, once it shows the problem (and is enabled again after a try)
  useLayoutEffect(() => {
    if (!err?.field) return;
    const el = err.field === "user" ? userRef.current : pwRef.current;
    el?.focus(); el?.select();
  }, [err]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !pw) {
      const field = !user.trim() ? "user" : "pw";
      setErr({ field, text: !user.trim() && !pw ? "Enter your username and password." : !user.trim() ? "Enter your username." : "Enter your password." });
      return;
    }
    setErr(null);
    setBusy(true);
    const r = await signIn(user.trim(), pw, keep);
    setBusy(false);
    if (!r.ok) { setErr(failureOf(r.problem)); return; }
    goOn();
  };
  const ErrIcon = err?.icon;
  const big = isEasy;
  return (
    <div className={cn("min-h-full flex justify-center bg-ground px-4", isPhone ? "items-start pt-10 pb-10" : "items-start pt-[12vh] pb-10", big && "text-[16px] leading-[24px]")}>
      <form onSubmit={submit} noValidate aria-busy={busy || undefined} className={isPhone ? "w-full flex flex-col gap-6" : "card w-full max-w-[420px] p-8 flex flex-col gap-6 shadow-pop"}>
        <div className="flex items-center gap-3">
          <AppMark size={52} />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">GST Billing</h1>
            <p className={cn("text-muted", big && "text-md")}>Sign in with your username and password.</p>
          </div>
        </div>
        {expired ? (
          <Banner tone="brand" icon={Clock} title="You were signed out after a long break">
            Sign in again. Nothing you saved is affected.
          </Banner>
        ) : null}
        {query.get("reason") === "signed_out" ? <Banner tone="brand" icon={Clock}>You were signed out on this device. Sign in again.</Banner> : null}
        {err?.title && ErrIcon ? (
          <div role="alert" className="flex items-start gap-3 rounded-card border border-neg-line bg-neg-tint px-4 py-3 anim-rise">
            <ErrIcon size={20} className="text-neg shrink-0 mt-0.5" aria-hidden="true" />
            <div><p className="font-semibold">{err.title}</p><p className={cn("text-fg2 mt-0.5", big ? "text-md" : "text-sm")}>{err.text}</p></div>
          </div>
        ) : null}
        <Field label="Username" htmlFor="login-user" error={err?.field === "user" ? err.text : ""}>
          <Input ref={userRef} id="login-user" value={user} onChange={(e) => { setUser(e.target.value); if (err?.field) setErr(null); }} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy}
            aria-invalid={err?.field === "user" || undefined} data-autofocus="" />
        </Field>
        <Field label="Password" htmlFor="login-pw" error={err?.field === "pw" && !err.title ? err.text : ""}>
          <div className="relative">
            <input ref={pwRef} id="login-pw" type={show ? "text" : "password"} value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} autoComplete="current-password" disabled={busy}
              aria-invalid={err?.field === "pw" || undefined} aria-describedby={err?.field === "pw" ? (err.title ? undefined : "login-pw-error") : undefined} className="ctl pr-12" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center text-muted hover:text-fg rounded-md">
              {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </Field>
        <Checkbox label="Keep me signed in on this device" checked={keep} onChange={setKeep} disabled={busy} />
        <Button type="submit" variant="primary" size="lg" icon={LogIn} full loading={busy} className={big ? "!min-h-14 !text-lg" : undefined}>{busy ? "Signing in…" : "Sign in"}</Button>
        <div className={cn("flex items-center justify-between gap-3 text-muted", big ? "text-md" : "text-sm")}>
          <Button variant="link" onClick={() => setForgot(true)}>Forgot your password?</Button>
          <span className="tnum shrink-0">Version {APP_VERSION}</span>
        </div>
      </form>
      {forgot ? (
        <ForgotBoundary key={forgotTry} fallback={<ForgotUnavailable onClose={() => setForgot(false)} onRetry={() => { setForgotTry((n) => n + 1); setForgotPage(() => lazy(loadForgot)); }} />}>
          <Suspense fallback={<p role="status">Loading password help…</p>}><ForgotPage open onClose={() => setForgot(false)} /></Suspense>
        </ForgotBoundary>
      ) : null}
    </div>
  );
}

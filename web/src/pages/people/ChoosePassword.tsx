import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { useSignOutAction } from "@/core/auth/useSignOutAction";
import { useProfile } from "@/core/api/account";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { AppMark, Button, QueryView, useDocTitle } from "@/core/ui";
import { ChangePasswordForm } from "./PasswordFields";
import { safeNext } from "@/pages/core/Login";

export default function ChoosePassword() {
  const { me } = useAuth();
  const profile = useProfile();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const next = safeNext(query.get("next")) || "/";
  const { isPhone } = useView();
  const { leave, busy, error } = useSignOutAction();
  useDocTitle("Choose your own password");
  if (me && !me.mustChangePassword) return <Navigate to={next} replace />;
  return <main className={cn("min-h-full flex justify-center bg-ground px-4", isPhone ? "items-start pt-10 pb-10" : "items-start pt-[12vh] pb-10")}>
    <section className={isPhone ? "w-full flex flex-col gap-6" : "card w-full max-w-[580px] p-8 flex flex-col gap-6 shadow-pop"}>
      <div className="flex items-center gap-3"><AppMark size={52} /><h1 className="text-2xl font-semibold leading-tight">Choose your own password</h1></div>
      <p className="text-fg2">Choose your own password first. The owner set this one for you.</p>
      <QueryView query={profile} what="your profile">{(person) => <ChangePasswordForm person={person} forced onChanged={() => navigate(next, { replace: true })} />}</QueryView>
      {error ? <p role="alert" className="text-neg">{error}</p> : null}
      <Button variant="link" className="self-start" loading={busy} onClick={() => void leave()}>Sign out</Button>
    </section>
  </main>;
}

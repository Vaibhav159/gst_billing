import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Building2, Users, Package, ReceiptText, Check, ArrowRight, SkipForward, Undo2, Sparkles, LayoutDashboard } from "lucide-react";
import { useSetup, type SetupSummary } from "@/core/api/setup";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { usePrefs, type SetupPrefs } from "@/core/prefs";
import { useView } from "@/core/view";
import { cn } from "@/core/cn";
import { cancelledNote } from "./words";
import { AppMark, Badge, Banner, Button, ButtonLink, Card, Page, QueryView, SuccessMark, useToast } from "@/core/ui";
import { SaveError } from "@/pages/customers/parts";

function SetupBody({ data }: { data: SetupSummary }) {
  const { can, whyNot } = useAuth();
  const { prefs, setPrefs, loading: prefsLoading, unavailable, retry } = usePrefs();
  // the server merges a PATCH at the top level: writing setup before this person's choices are read would replace them
  const prefsOff = prefsLoading || unavailable !== null;
  const { isPhone } = useView();
  const navigate = useNavigate();
  const { show } = useToast();
  const setup = prefs.setup ?? { dismissed: false, skipped: [] };
  const skipped = Array.isArray(setup.skipped) ? setup.skipped : [];
  const [failure, setFailure] = useState<{ problem: ApiProblem; patch: Partial<SetupPrefs>; id: string; leave: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = useRef(false);
  const count = (amount: number, name: string) => amount + " " + name + (amount === 1 ? "" : "s");
  const names = (row: { count: number; names: string[] }) => row.names.slice(0, 3).join(", ") + (row.count > row.names.length ? " and " + (row.count - row.names.length) + " more" : "");
  const steps = [
    { id: "firm", icon: Building2, title: data.firms.count ? "Your business" : "Add your business", desc: "Your GST registration: GSTIN, address and bill numbers. They print on every bill.",
      done: data.firms.count > 0, doneText: count(data.firms.count, "firm") + ": " + names(data.firms), cta: data.firms.count ? "Add another firm" : "Add your first business", to: data.firms.count ? "/firms/new" : "/firms/new?first=1", perm: "firm.edit" as const },
    { id: "customer", icon: Users, title: "Add a customer", desc: "A name and phone are enough. Businesses add their GSTIN, for B2B bills.",
      done: data.customers.count > 0, doneText: count(data.customers.count, "customer") + " on file, besides walk-in sales", cta: "Add a customer", to: "/customers/new?return=%2Fsetup", perm: "customer.edit" as const },
    { id: "product", icon: Package, title: "Add a product", desc: "With its HSN code and GST rate, so every bill line gets them right.",
      done: data.products.count > 0, doneText: count(data.products.count, "product") + " with HSN and GST rate", cta: "Add a product", to: "/products/new?return=%2Fsetup", perm: "product.edit" as const },
    { id: "bill", icon: ReceiptText, title: "Make your first bill", desc: "Pick the customer and the products; the GST splits itself into CGST and SGST, or IGST.",
      done: data.bills.count > 0, doneText: count(data.bills.count, "sales bill") + " made" + cancelledNote(data.bills.cancelled), cta: "Make a bill", to: "/sales/new", perm: "bill.create" as const },
  ] as const;
  const newShop = data.firms.count === 0;
  const doneCount = steps.filter((step) => step.done).length;
  const skipCount = steps.filter((step) => !step.done && skipped.includes(step.id)).length;
  const settled = doneCount + skipCount;
  const current = steps.find((step) => !step.done && !skipped.includes(step.id));
  const save = async (patch: Partial<SetupPrefs>, id: string, leave = false) => {
    if (active.current || prefsOff) return;
    active.current = true; setBusyId(id);
    try {
      await setPrefs({ setup: { dismissed: Boolean(setup.dismissed), skipped, ...patch } });
      setFailure(null);
      if (leave) { show({ title: "Setup hidden", body: "Run it again any time from Settings › Data and setup." }); navigate("/"); }
    } catch (error) { setFailure({ problem: problemOf(error), patch, id, leave }); }
    finally { active.current = false; setBusyId(null); }
  };
  const leave = <Button variant="ghost" icon={SkipForward} loading={busyId === "all"} disabled={prefsOff} onClick={() => void save({ dismissed: true }, "all", true)}>Skip setup</Button>;
  return <Page icon={Sparkles} title="Set up GST Billing" back="/settings" context={newShop ? "A new shop · four steps, about ten minutes in all" : doneCount + " of 4 done" + (skipCount ? " · " + skipCount + " skipped" : "") + " · each step ticks itself when it's done"}
    phoneSubtitle={newShop ? "A new shop · four steps" : doneCount + " of 4 done"} actions={newShop ? null : settled < 4 ? leave : <ButtonLink to="/" variant="primary" icon={LayoutDashboard}>Go to the dashboard</ButtonLink>} phoneActions={!newShop && settled < 4 ? leave : null}>
    {newShop ? <Card><div className={cn("flex gap-4", isPhone ? "flex-col" : "items-center")}><AppMark size={56} /><div className="flex-1 min-w-0"><h2 className="text-xl font-semibold">Welcome to GST Billing</h2><p className="text-fg2 mt-1">There's no business here yet. Start with yours: its GSTIN, address and bill numbers. It takes about two minutes, and everything else (customers, products, bills, GST returns) follows from it.</p>{!can("firm.edit") ? <p className="mt-2">Ask the owner to add the business first</p> : null}</div></div></Card> : null}
    {unavailable ? <Banner tone="neg" role="presentation" title="Your preferences didn't load" actions={<Button size="sm" onClick={() => void retry()}>Try again</Button>}>Skipping steps waits for them, so the steps you skipped before aren't lost.</Banner> : null}
    <SaveError problem={failure?.problem ?? null} onRetry={failure ? () => void save(failure.patch, failure.id, failure.leave) : undefined} />
    <div className="flex flex-col gap-2" aria-hidden="true"><div className="flex gap-1.5">{steps.map((step) => <span key={step.id} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", step.done ? "bg-sale" : skipped.includes(step.id) ? "bg-muted/50" : step === current ? "bg-brand" : "bg-line")} />)}</div></div>
    {!newShop && settled === 4 ? <Card><div className="flex flex-col items-center text-center gap-2 py-4 anim-rise" role="status"><SuccessMark size={64} /><p className="text-lg font-semibold mt-1">{doneCount === 4 ? "You're set up" : "Setup is done for now"}</p><p className="text-fg2 max-w-[52ch]">{doneCount === 4 ? "Your business, customers, products and bills are all in. Everything below can be changed any time." : "The skipped steps stay here; come back from Settings → Data whenever you like."}</p><ButtonLink to="/" variant="primary" icon={LayoutDashboard} className="mt-2">Go to the dashboard</ButtonLink></div></Card> : null}
    <ol className="flex flex-col gap-3">{steps.map((step, index) => {
      const isSkipped = skipped.includes(step.id);
      const blocked = step.id !== "firm" && newShop;
      const allowed = can(step.perm);
      const Icon = step.icon;
      return <li key={step.id}><Card pad={false} className={cn(step === current && "border-brand-line")}><div className={cn("flex gap-4", isPhone ? "flex-col p-4" : "items-center p-5")}>
        <div className="flex items-start gap-4 flex-1 min-w-0"><span aria-hidden="true" className={cn("w-11 h-11 rounded-card grid place-items-center shrink-0 border transition-colors", step.done ? "bg-sale-tint border-sale-line text-sale" : step === current ? "bg-brand-tint border-brand-line text-brand" : "bg-raised border-line text-fg2")}>{step.done ? <Check size={22} strokeWidth={2.5} /> : <Icon size={20} />}</span>
          <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted tnum">Step {index + 1}</span><span className="text-md font-semibold">{step.title}</span>{step.done ? <Badge tone="sale" icon={Check}>Done</Badge> : isSkipped ? <Badge>Skipped</Badge> : null}</p><p className="text-fg2 mt-0.5">{step.done ? step.doneText : step.desc}</p>
            {!step.done && blocked ? <p className="text-sm text-muted mt-1">After step 1: customers, products and bills belong to a firm.</p> : null}
            {!step.done && !blocked && !allowed ? <p className="text-sm text-muted mt-1">{whyNot(step.perm, step.cta.toLowerCase())}</p> : null}
          </div>
        </div>
        <div className={cn("flex gap-2 shrink-0", isPhone ? "flex-col" : "items-center")}>
          {step.done ? step.id === "firm" && allowed ? <ButtonLink to={step.to} variant="ghost" size="sm">{step.cta}</ButtonLink> : null : isSkipped ? <>
            <Button variant="ghost" size="sm" icon={Undo2} loading={busyId === step.id} disabled={prefsOff || (busyId !== null && busyId !== step.id)} onClick={() => void save({ skipped: skipped.filter((id) => id !== step.id) }, step.id)}>Undo skip</Button>
            {!blocked && allowed ? <ButtonLink to={step.to} size="sm" iconRight={ArrowRight}>Do it now</ButtonLink> : null}
          </> : <>
            {blocked || !allowed ? <Button variant={step === current ? "primary" : "secondary"} disabled iconRight={ArrowRight}>{step.cta}</Button> : <ButtonLink to={step.to} variant={step === current ? "primary" : "secondary"} iconRight={ArrowRight}>{step.cta}</ButtonLink>}
            {!newShop || step.id !== "firm" ? <Button variant="ghost" aria-label={"Skip: " + step.title.toLowerCase()} loading={busyId === step.id} disabled={prefsOff || (busyId !== null && busyId !== step.id)} onClick={() => void save({ skipped: [...new Set([...skipped, step.id])] }, step.id)}>Skip</Button> : null}
          </>}
        </div>
      </div></Card></li>;
    })}</ol>
    <p className="text-sm text-muted">Each step ticks itself as soon as the thing exists, whoever adds it. {newShop ? "Customers, products and bills belong to a business, so it comes first." : "Skipping a step only hides the nudge."}</p>
  </Page>;
}
export default function Setup() {
  const query = useSetup();
  return <QueryView query={query} what="the setup checklist">{(data) => <SetupBody data={data} />}</QueryView>;
}

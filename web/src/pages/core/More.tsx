// Phone Expert "More" tab: everything that isn't a tab, grouped, with live counts.
// Easy mode sits at the top (someone who came over from Easy finds the way back at once).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BarChart3, Building2, DatabaseBackup, History, Inbox, Landmark, LifeBuoy, LogOut, Maximize2, Package, QrCode, Settings, ShieldCheck, ShoppingBag, Sparkles, Truck, Type, UserRound, type LucideIcon } from "lucide-react";
import { problemOf, saveFailure, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { TEXT_SIZES, useTextSize } from "@/core/device";
import { addMonths, date, monthLabel, monthOf, todayIST } from "@/core/format";
import { usePrefs } from "@/core/prefs";
import { MORE_NAV } from "@/core/shell/nav";
import { Button, Card, ConfirmDialog, Dialog, Disclosure, ListRow, Menu, Page, Spinner, useToast } from "@/core/ui";
import { useView } from "@/core/view";

const HELP = [
  ["Make a bill", "Home → New bill. Pick the customer (or Walk-in), add each piece with its weight; the rate comes from today's rates board. Check the bill, pick how they paid, and save. Then send it on WhatsApp or print it."],
  ["Capture a supplier's bill", "Capture tab → Take a photo (or pick a PDF). The app reads it while you carry on; fill it in later from Captured bills. A photo it can't read is kept, with Take it again."],
  ["Send a bill again", "Bills → open the bill → Send again. In a list, tap Sent to see when it went and send it again."],
  ["Fix a mistake on a bill", "Open the bill → Edit, while its month's GSTR-1 isn't filed. In a filed month the owner unlocks it first, and the change goes in next month's GSTR-1 as an amendment. A bill made by mistake can be cancelled (it keeps its number) or deleted (it can be restored from the Audit log)."],
  ["GST each month", "Due next on Home shows what stops a return and what's due. GSTR-1 is due on the 11th and GSTR-3B on the 20th: they're filed on the GST portal at the computer, then marked filed here."],
  ["Today's rates", "Home → Today's rates → Change. Type gold per 10 g and silver per kg, the way the board reads; every new bill line takes its rate from there."],
  ["Bigger text, or a bright screen", "More → Text size makes everything bigger on this phone. The sun button on Home switches to the light theme for a sunny counter."],
] as const;

/** A mode switch the server didn't keep, in the app's words for a save that didn't happen (saveFailure), with what to do now. */
function notSwitched(p: ApiProblem): { title: string; body: string } {
  const { title, body } = saveFailure(p);
  if (p.kind === "offline") return { title, body: "Switch again when the internet is back." };
  if (p.kind === "unreachable" || p.kind === "server") return { title, body: "Nothing was changed. Try again in a minute." };
  return { title, body };
}

export default function More() {
  const { me, can, signOut } = useAuth();
  const { isEasy } = useView();
  const { setPrefs } = usePrefs();
  const [textSize, setTextSize] = useTextSize();
  const navigate = useNavigate();
  const { show } = useToast();
  const net = useNetwork();
  const [leaving, setLeaving] = useState(false);
  const [help, setHelp] = useState(false);
  const [switching, setSwitching] = useState(false);
  // a switch answered after the person left the page doesn't pull them back to a home
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);
  const prev = addMonths(monthOf(todayIST()), -1);
  const icon = (I: LucideIcon) => <span className="w-9 h-9 rounded-ctl bg-raised grid place-items-center text-fg2"><I size={18} aria-hidden="true" /></span>;
  const group = (title: string, rows: ReactNode) => (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="caps px-1">{title}</h2>
      <Card pad={false}>{rows}</Card>
    </section>
  );
  // the pages under More show only to a role that may open them (nav.ts says what each needs)
  const may = (to: string) => { const need = MORE_NAV.find((m) => m.to === to)?.need; return !need || can(need); };
  const sizeNow = TEXT_SIZES.find((t) => t.value === textSize) || TEXT_SIZES[0];

  // Easy or Expert is this person's setting: it's kept first, so the home it opens agrees with it (AppLayout reads it)
  const to = isEasy ? "expert" : "easy";
  const switchMode = async () => {
    if (switching) return;
    if (net === "offline") { show({ tone: "neg", ...notSwitched({ kind: "offline", message: "You're offline" }) }); return; }
    setSwitching(true);
    try {
      await setPrefs({ phoneMode: to });
      if (here.current) navigate(to === "easy" ? "/e" : "/", { replace: true });
    } catch (e) {
      show({ tone: "neg", ...notSwitched(problemOf(e)) });
    } finally {
      if (here.current) setSwitching(false);
    }
  };

  return (
    <Page title="More" phoneSubtitle={`${me?.fullName} · ${me?.roleLabel}`}>
      <Card pad={false}>
        <ListRow onClick={() => void switchMode()} aria-busy={switching || undefined}
          leading={<span className="w-9 h-9 rounded-ctl bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0">{isEasy ? <Maximize2 size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}</span>}
          title={isEasy ? "Switch to Expert" : "Switch to Easy"}
          subtitle={isEasy ? "All the screens: purchases, GST returns, reports." : "Big buttons and plain words: make a bill in two steps, send it on WhatsApp, snap supplier bills."}
          right={switching ? <Spinner /> : null} />
      </Card>
      {group("Every day", <>
        <ListRow to="/purchases" leading={icon(ShoppingBag)} title="Purchases" />
        {can("purchase.create") ? <ListRow to="/purchases/inbox" leading={icon(Inbox)} title="Captured bills to fill in" subtitle="Photos waiting to become purchases" /> : null}
        <ListRow to="/gst" leading={icon(Landmark)} title="GST returns" subtitle={`${monthLabel(prev, { long: true, year: false })}: GSTR-1 due ${date(`${addMonths(prev, 1)}-11`)}`} />
        <ListRow to="/reports" leading={icon(BarChart3)} title="Reports" subtitle="Registers, HSN summary, month by month" />
        <ListRow to="/scan" leading={icon(QrCode)} title="Check a bill's QR code" subtitle="Scan a printed bill to open it" />
      </>)}
      {group("Records", <>
        {may("/products") ? <ListRow to="/products" leading={icon(Package)} title="Products" /> : null}
        <ListRow to="/suppliers" leading={icon(Truck)} title="Suppliers" />
        {may("/firms") ? <ListRow to="/firms" leading={icon(Building2)} title="Firms" subtitle="GSTIN, bank details, bill numbers" /> : null}
      </>)}
      {group("Admin", <>
        {may("/users") ? <ListRow to="/users" leading={icon(ShieldCheck)} title="Users and roles" /> : null}
        {may("/backup") ? <ListRow to="/backup" leading={icon(DatabaseBackup)} title="Backup and restore" /> : null}
        {may("/audit") ? <ListRow to="/audit" leading={icon(History)} title="Audit log" subtitle="Who changed what, and restore deleted bills" /> : null}
        {may("/settings") ? <ListRow to="/settings" leading={icon(Settings)} title="Settings" subtitle="Bill defaults, numbering, messages" /> : null}
        <ListRow to="/profile" leading={icon(UserRound)} title="Profile and password" />
      </>)}
      {group("Help", <>
        <ListRow onClick={() => setHelp(true)} leading={icon(LifeBuoy)} title="How do I…" subtitle="Make a bill, capture a supplier's bill, send again, fix a mistake, GST each month" />
      </>)}
      {group("This phone", <>
        <Menu title="Text size on this phone" width={260}
          items={TEXT_SIZES.map((t) => ({ label: t.label, hint: t.hint || "As designed", icon: Type, checked: t.value === sizeNow.value, onSelect: () => setTextSize(t.value) }))}
          trigger={(p) => <ListRow {...p} onClick={p.onClick} leading={icon(Type)} title="Text size" subtitle={`${sizeNow.label}${sizeNow.hint ? ` · ${sizeNow.hint.toLowerCase()}` : ""}`} />} />
      </>)}
      <Dialog open={help} onClose={() => setHelp(false)} title="How do I…" description="The everyday jobs, in a few steps each.">
        <div className="flex flex-col divide-y divide-rule -mt-2">
          {HELP.map(([q, a]) => <Disclosure key={q} title={q}><p className="text-fg2">{a}</p></Disclosure>)}
        </div>
      </Dialog>
      <Button variant="danger-outline" icon={LogOut} full onClick={() => setLeaving(true)}>Sign out</Button>
      {/* signed out, the app's sign-in check takes this tab to a plain sign-in page */}
      <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} title="Sign out of this phone?" cancelLabel="Stay signed in" confirmLabel="Sign out"
        onConfirm={() => { setLeaving(false); signOut(); }}>
        <p>You'll need your password to sign in again. Unfinished bills stay on this phone.</p>
      </ConfirmDialog>
    </Page>
  );
}

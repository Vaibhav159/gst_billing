import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Maximize2, Building2, HelpCircle, Sparkles, LogOut, ChevronRight, Check, Send, ReceiptText, Undo2, Palette, UserRound, CalendarDays, Type, type LucideIcon } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { TEXT_SIZES, useTextSize, useTheme, type Theme } from "@/core/device";
import { fyOf, rangeLabel, todayIST } from "@/core/format";
import { usePrefs } from "@/core/prefs";
import type { Firm } from "@/core/scope";
import { Button, ConfirmDialog, Dialog, cn } from "@/core/ui";

const EASY_THEMES: [Theme, string, string][] = [
  ["obsidian", "Obsidian", "Gold on black, the usual look"],
  ["pearl", "Pearl", "Light, easier to read in a bright shop"],
  ["sapphire", "Sapphire", "Sky blue on navy"],
  ["ember", "Ember", "Coral on charcoal"],
  ["forest", "Forest", "Green on deep green"],
];

const HELP: Record<string, { title: string; icon: LucideIcon; steps: string[] }> = {
  make: {
    title: "How to make a bill",
    icon: ReceiptText,
    steps: [
      "Tap New bill at the bottom of Home or Bills.",
      "Who is buying? Search their name or phone, pick a recent customer, or tap Walk-in customer.",
      "Tap what they are buying, then type the weight and Rate per gram, as on the paper bill. Making is included in this rate. Not in the list? Tap Not in the list? Add it.",
      "For an older bill, tap Change in Bill number, then A bill from an earlier day. Type the date and number from the paper bill.",
      "The button at the bottom always says what's next: the weight, how they paid, then Check and save. Read the one-line summary, tick anything shown in red, and tap Save.",
    ],
  },
  send: {
    title: "How to send a bill",
    icon: Send,
    steps: [
      "Tap Send the bill. Your phone's share menu opens with the bill's PDF: pick WhatsApp, then the customer.",
      "If your phone cannot share the PDF, check the number under Goes to. Wrong number? Tap Change and fix it first.",
      "When the sharing is done, the bill says Sent with the time. To send it again, open the bill and tap Send again. In lists, Sent is only a label.",
      "Forgot to send one? Open Bills, open the bill, and tap Send the bill. Print prints it on A4.",
    ],
  },
  mistake: {
    title: "Made a mistake on a bill?",
    icon: Undo2,
    steps: [
      "Only the owner can cancel a bill. If you are not the owner, tell them the bill number.",
      "The owner opens the bill and taps Made a mistake? Cancel this bill, then confirms.",
      "The bill stays in the list marked Cancelled and keeps its number, so the GST list stays complete.",
      "Then tap Make it again: a new bill opens with the same customer, items and payment, ready to correct.",
    ],
  },
};

export type EasyMoreFirm = Firm & { location?: string };
export type MoreBodyProps = { firms: EasyMoreFirm[]; firm: Firm | null; setFirm: (id: number) => void; resetWelcome: () => void; loading?: boolean; error?: string; onRetry?: () => void };
export function MoreBody({ firms, firm, setFirm, resetWelcome, loading, error, onRetry }: MoreBodyProps) {
  const { me, signOut } = useAuth();
  const { setPrefs } = usePrefs();
  const [theme, setTheme] = useTheme();
  const [textSize, setTextSize] = useTextSize();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchProblem, setSwitchProblem] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutProblem, setLogoutProblem] = useState("");
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);
  const h = sheet ? HELP[sheet] : undefined;
  const today = todayIST();
  const fy = fyOf(today);
  const y = { fy, from: `${fy.slice(0, 4)}-04-01` };
  const ly = { fy: fyOf(`${Number(fy.slice(0, 4)) - 1}-04-01`) };
  const early = ["04", "05"].includes(today.slice(5, 7));
  const themeName = EASY_THEMES.find(([v]) => v === theme)?.[1] || "Obsidian";
  const sizeName = TEXT_SIZES.find((t) => t.value === textSize)?.label || "Normal";
  const pick = (f: Firm) => { setFirm(f.id); setSheet(null); };
  const switchMode = async () => {
    if (switching) return;
    setSwitching(true); setSwitchProblem("");
    try { await setPrefs({ phoneMode: "expert" }); if (here.current) navigate("/", { replace: true }); }
    catch (error) {
      const p = problemOf(error);
      if (here.current) setSwitchProblem(p.kind === "offline" ? "Switch again when the internet is back." : p.kind === "server" || p.kind === "unreachable" ? "Nothing was changed. Try again in a minute." : p.message);
    } finally { if (here.current) setSwitching(false); }
  };
  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true); setLogoutProblem("");
    try { await signOut(); if (here.current) setSheet(null); }
    catch (error) { if (here.current) setLogoutProblem(problemOf(error).message); }
    finally { if (here.current) setLogoutBusy(false); }
  };

  return (
    <>
      <section aria-label="Full view" className="card overflow-hidden">
        <Row onClick={() => void switchMode()} busy={switching} I={Maximize2} tone="brand" title="Switch to the full view" sub="All the screens: purchases, GST returns, reports. Back to Easy is at the top of every screen there." />
      </section>

      {switchProblem ? <p role="alert" className="text-neg">{switchProblem}</p> : null}
      <Group title="This phone">
        <Row onClick={() => setSheet("firm")} I={Building2} title="Firm on this phone" sub={firm ? `Billing for ${firm.name}` : "Choose a firm"} />
        <Row onClick={() => setSheet("theme")} I={Palette} title="Theme" sub={themeName} />
        <Row onClick={() => setSheet("text")} I={Type} title="Text size" sub={sizeName} />
        <Row onClick={() => navigate("/e/profile")} I={UserRound} title="Profile and password" sub={`${me?.fullName || ""} · @${me?.username || ""}`} />
      </Group>

      <Group title="This shop">
        <Row onClick={() => setSheet("year")} I={CalendarDays} title={`Financial year ${y.fy}`} sub="Easy always shows this year" />
      </Group>

      <Group title="Help" icon={HelpCircle}>
        {Object.entries(HELP).map(([k, v]) => <Row key={k} onClick={() => setSheet(k)} I={v.icon} title={v.title} />)}
        <Row onClick={() => { resetWelcome(); navigate("/e"); }} I={Sparkles} title="Show the welcome again" sub="The three-point tour on Home" />
      </Group>

      <Button variant="danger-outline" size="lg" icon={LogOut} full onClick={() => setSheet("logout")}>Log out</Button>

      <Dialog open={sheet === "firm"} onClose={() => setSheet(null)} title="Which firm are you billing for?" description="Only this phone changes. Other phones keep their own firm.">
        {loading ? <p role="status" className="text-md text-muted mb-3">Getting firms…</p> : null}
        {error ? <div className="flex flex-col gap-2 mb-3"><p role="alert" className="text-md text-neg">{error}</p>
          {onRetry ? <Button onClick={onRetry} loading={loading} className="self-start">Try again</Button> : null}</div> : null}
        <div role="radiogroup" aria-label="Firm" className="flex flex-col gap-2">
          {firms.map((f) => {
            const on = f.id === firm?.id;
            return (
              <button key={f.id} type="button" role="radio" aria-checked={on} onClick={() => pick(f)}
                className={cn("w-full flex items-center gap-3 rounded-card border px-4 py-3 min-h-[72px] text-left transition-[border-color,background-color] duration-150",
                  on ? "border-brand bg-brand-sel" : "border-ctl-line bg-field hover:border-muted/50")}>
                <span className="flex-1 min-w-0">
                  <span className={cn("block font-medium", on && "text-brand")}>{f.name}</span>
                  <span className="block text-md text-muted">Bills numbered {f.prefix ? `${f.prefix}/${y.fy}/1, 2, 3…` : "1, 2, 3…"} · {f.location || f.state}</span>
                </span>
                {on ? <Check size={20} className="text-brand shrink-0" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </Dialog>

      <Dialog open={sheet === "theme"} onClose={() => setSheet(null)} title="Theme on this phone" description="Changes how the app looks on this phone only.">
        <ChoiceList label="Theme" items={EASY_THEMES.map(([v, name, hint]) => ({ value: v, name, hint }))} value={theme} onPick={(v) => { setTheme(v); setSheet(null); }} />
      </Dialog>

      <Dialog open={sheet === "text"} onClose={() => setSheet(null)} title="Text size on this phone" description="Everything grows together, so nothing gets cut off.">
        <ChoiceList label="Text size" items={TEXT_SIZES.map((t) => ({ value: t.value, name: t.label, hint: t.hint || "The size it comes with" }))} value={textSize} onPick={(v) => { setTextSize(v); setSheet(null); }} />
      </Dialog>

      <Dialog open={sheet === "year"} onClose={() => setSheet(null)} title={`Financial year ${y.fy}`} footer={<Button variant="primary" size="lg" onClick={() => setSheet(null)}>Got it</Button>}>
        <div className="flex flex-col gap-3 text-fg">
          <p>Easy mode always shows this financial year: {rangeLabel(y.from, today)} so far. New bills get this year's numbers, starting again at 1 each April.</p>
          {ly ? <p>Need a bill from last year (FY {ly.fy})? In Bills, search for it and tick “Show last year's bills too”.{early ? " In April and May that's already ticked for you." : ""}</p> : null}
          <p className="text-fg2">To look at a whole past year, switch to the full view and pick the year at the top of its Home.</p>
        </div>
      </Dialog>

      <ConfirmDialog open={sheet === "logout"} onClose={() => setSheet(null)} onConfirm={() => void logout()} busy={logoutBusy} tone="danger"
        title="Log out of this phone?" confirmLabel="Log out" cancelLabel="Stay signed in">
        <p>You'll need your password to sign in again.</p>
        {logoutProblem ? <p role="alert" className="text-neg">{logoutProblem}</p> : null}
      </ConfirmDialog>

      <Dialog open={Boolean(h)} onClose={() => setSheet(null)} title={h?.title || ""} footer={<Button variant="primary" size="lg" onClick={() => setSheet(null)}>Got it</Button>}>
        {h ? (
          <ol className="flex flex-col gap-3">
            {h.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span aria-hidden="true" className="w-8 h-8 rounded-full bg-brand-tint border border-brand-line text-brand font-semibold grid place-items-center shrink-0 tnum">{i + 1}</span>
                <span className="pt-1 text-fg">{s}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </Dialog>
    </>
  );
}

function ChoiceList<T extends string | number>({ label, items, value, onPick }: { label: string; items: { value: T; name: string; hint: string }[]; value: T; onPick: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button key={String(it.value)} type="button" role="radio" aria-checked={on} onClick={() => onPick(it.value)}
            className={cn("w-full flex items-center gap-3 rounded-card border px-4 py-3 min-h-16 text-left transition-[border-color,background-color] duration-150",
              on ? "border-brand bg-brand-sel" : "border-ctl-line bg-field hover:border-muted/50")}>
            <span className="flex-1 min-w-0">
              <span className={cn("block font-medium", on && "text-brand")}>{it.name}</span>
              <span className="block text-md text-muted">{it.hint}</span>
            </span>
            {on ? <Check size={20} className="text-brand shrink-0" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function Group({ title, icon: I, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-[16px] font-medium text-fg2 px-1">{I ? <I size={18} aria-hidden="true" /> : null}{title}</h2>
      <div className="card overflow-hidden">{children}</div>
    </section>
  );
}

function Row({ onClick, I, tone, title, sub, busy }: { onClick: () => void; I: LucideIcon; tone?: "brand"; title: string; sub?: string; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined} className="w-full flex items-center gap-3 px-4 py-3 min-h-[72px] text-left border-t border-rule first:border-t-0 transition-colors hover:bg-raised/60">
      <span aria-hidden="true" className={cn("w-11 h-11 rounded-ctl grid place-items-center shrink-0 border", tone === "brand" ? "bg-brand-tint border-brand-line text-brand" : "bg-raised border-line text-fg2")}><I size={20} /></span>
      <span className="flex-1 min-w-0"><span className="block font-medium">{title}</span>{sub ? <span className="block text-md text-muted">{sub}</span> : null}</span>
      <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
    </button>
  );
}

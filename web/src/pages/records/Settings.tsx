import { BillReference } from "@/core/sales/BillReference";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Settings as SettingsIcon, Keyboard, DatabaseBackup, History, Sparkles, Info, ArrowRight, RotateCcw } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useFirmNumbers, type FirmRow } from "@/core/api/firms";
import { useShopSettings } from "@/core/api/sales";
import { useSetup } from "@/core/api/setup";
import { usePrefs, phoneModeOf } from "@/core/prefs";
import { THEMES, useTheme, type Theme } from "@/core/device";
import { useView } from "@/core/view";
import { cn } from "@/core/cn";
import { date, todayIST } from "@/core/format";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { dayOf } from "@/core/sales/words";
import { DEFAULT_SHARE_MESSAGE, fillMessage } from "@/core/sales/share";
import type { ShopSettings } from "@/core/sales/types";
import { ShortcutsDialog } from "@/core/shell/ShortcutsDialog";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, Kbd, Page, QueryView, Select, Switch, Table, Td, Textarea, Th, Tr } from "@/core/ui";
import { messageProblem, PLACEHOLDERS, useSettingRows } from "./settingsModel";

const SECTIONS = [["set-appearance", "This device"], ["set-you", "You"], ["set-bills", "Bills"], ["set-numbering", "Bill numbers"], ["set-gst", "GST"], ["set-keys", "Keyboard"], ["set-data", "Data and setup"], ["set-about", "About"]] as const;
function Row({ label, description, htmlFor, children, status, stack = false }: { label: string; description?: ReactNode; htmlFor?: string; children: ReactNode; status?: ReactNode; stack?: boolean }) {
  const { isPhone } = useView();
  return <div className={cn("flex gap-x-6 gap-y-3 py-4 border-t border-rule first:border-t-0 first:pt-1", isPhone || stack ? "flex-col" : "items-center justify-between")}>
    <div className="min-w-0 max-w-[56ch]"><p className="font-medium flex items-center gap-2">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</p>{description ? <p className="text-sm text-muted mt-0.5">{description}</p> : null}</div>
    <div className={cn("flex items-center gap-3 min-w-0", isPhone || stack ? "flex-wrap" : "shrink-0 justify-end")}>{isPhone || stack ? null : status}{children}{isPhone || stack ? status : null}</div>
  </div>;
}
function Choice<T extends string>({ label, value, choices, onChange, disabled = false }: { label: string; value: T; choices: { value: T; label: string; sub: string }[]; onChange(value: T): void; disabled?: boolean }) {
  const { isPhone } = useView();
  return <div role="radiogroup" aria-label={label} className={cn("grid gap-2", isPhone ? "grid-cols-1 w-full" : "grid-cols-2 w-[460px]")}
    onKeyDown={(event) => {
      if (disabled || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex((choice) => choice.value === value);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : choices.length - 1)) % choices.length;
      onChange(choices[next].value);
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    }}>
    {choices.map((choice) => <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} tabIndex={value === choice.value ? 0 : -1} disabled={disabled} onClick={() => onChange(choice.value)}
      className={cn("text-left rounded-ctl border px-3.5 py-2.5 min-h-11 flex items-start gap-3 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed", value === choice.value ? "bg-brand-sel border-brand" : "bg-field border-ctl-line hover:border-muted")}>
      <span className="min-w-0"><span className={cn("block font-medium", value === choice.value && "text-brand")}>{choice.label}</span><span className="block text-sm text-muted">{choice.sub}</span></span>
    </button>)}
  </div>;
}
function SettingsBody({ settings, firms, person }: { settings: ShopSettings; firms: FirmRow[]; person: number }) {
  const { me, can, whyNot } = useAuth();
  const { prefs, ready: prefsReady } = usePrefs();
  const { isPhone, isDesktop } = useView();
  const [theme, setTheme] = useTheme();
  const rows = useSettingRows(person);
  const setup = useSetup();
  const navigate = useNavigate();
  const [keys, setKeys] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [current, setCurrent] = useState<string>(SECTIONS[0][0]);
  const shop = can("settings.edit");
  const savedMessage = rows.value("shareMessage", "share_message", settings.share_message);
  const [message, setMessage] = useState(savedMessage);
  const previousMessage = useRef(savedMessage);
  useEffect(() => {
    const previous = previousMessage.current;
    setMessage((text) => text === previous ? savedMessage : text);
    previousMessage.current = savedMessage;
  }, [savedMessage]);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const problem = messageProblem(message);
  const guard = useUnsavedGuard(message !== savedMessage, "Your WhatsApp message isn't saved. Leave and lose the change?");
  const shopFirm = firms.find((firm) => firm.id === settings.default_business) ?? firms[0];
  const myFirm = rows.value<string | null>("myFirm", "defaultBusinessId", prefs.defaultBusinessId ?? null);
  const phoneMode = rows.value("phoneMode", "phoneMode", phoneModeOf(prefs));
  const hasMine = Boolean(prefs.defaultBusinessId || prefs.phoneMode || prefs.setup || Object.values(rows.pending).some((row) => row.scope === "me"));
  const rowStatus = (key: string) => <span role="status" className="text-sm">
    {rows.busy[key] ? "Saving…" : rows.pending[key] ? <span className="inline-flex flex-wrap items-center gap-2 text-neg">
      Not saved yet · kept on this device{rows.errors[key] ? <span>{rows.errors[key]}</span> : null}
      <Button size="sm" variant="ghost" disabled={rows.pending[key]?.scope === "shop" ? !shop : Boolean(rows.busy.reset || (key === "reset" && (rows.busy.myFirm || rows.busy.phoneMode || rows.busy.setup)))} onClick={() => void rows.retry(key)}>Try again</Button>
    </span> : rows.saved[key] ? <span className="text-sale">Saved</span> : null}
  </span>;
  const go = (id: string) => {
    const section = document.getElementById(id);
    section?.scrollIntoView({ block: "start" });
    const heading = section?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    setCurrent(id);
  };
  const insert = (text: string) => {
    const element = messageRef.current;
    const start = element?.selectionStart ?? message.length;
    const end = element?.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + text + message.slice(end));
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + text.length, start + text.length); });
  };
  const preview = fillMessage(message, { customer: "Anil Gupta", number: shopFirm?.numbers?.next.invoice_number ?? "KGH/2026-27/1", total: "₹1,234.56", firm: shopFirm?.name ?? "Your firm", date: date(todayIST()) });
  const sections = <div className="flex flex-col gap-5 min-w-0">
    <Card id="set-appearance" title="Appearance" subtitle="How the app looks on this device; other devices keep their own" actions={<Badge tone="brand">This device</Badge>}>
      <Row label="Theme" description="Obsidian is the classic gold on black. Pearl is light, for a bright shop or a sunny counter." stack>
        <Choice<Theme> label="Theme" value={theme} onChange={setTheme} choices={THEMES.map((item) => ({ ...item, sub: ({ obsidian: "Gold on black, the classic look", pearl: "Light, for a bright shop", sapphire: "Sky blue on navy", ember: "Coral on charcoal", forest: "Green on deep green" })[item.value] }))} />
      </Row>
    </Card>
    <Card id="set-you" title="You" subtitle={(me?.fullName ?? "Your") + "'s own preferences; they follow you to any device"} actions={<Badge tone="brand">Just for you</Badge>}>
      <Row label="Your default firm" htmlFor="set-myfirm" description={(myFirm ? "Your new bills start with this firm." : "Your new bills start with the shop's default, " + (shopFirm?.name ?? "the first firm") + ".") + " It's the firm you usually work for; you still see every firm."} status={rowStatus("myFirm")}>
        <Select id="set-myfirm" value={myFirm ?? ""} disabled={!prefsReady || rows.busy.reset || rows.busy.myFirm} onChange={(event) => void rows.mine("myFirm", { defaultBusinessId: event.target.value || null })}
          options={[{ value: "", label: "Same as the shop (" + (shopFirm?.short ?? "first firm") + ")" }, ...firms.map((firm) => ({ value: String(firm.id), label: firm.name }))]} />
      </Row>
      <Row label="Open on phones in" description="Expert has every screen. Easy has big buttons and the everyday screens. You can switch any time from More." stack status={rowStatus("phoneMode")}>
        <Choice label="Phone screens" value={phoneMode} disabled={!prefsReady || rows.busy.reset || rows.busy.phoneMode} onChange={(value) => void rows.mine("phoneMode", { phoneMode: value })} choices={[{ value: "expert", label: "Expert", sub: "Every screen" }, { value: "easy", label: "Easy", sub: "Big buttons, everyday screens" }]} />
      </Row>
      {isPhone ? <ButtonLink to="/e" full icon={Sparkles}>Switch to Easy now</ButtonLink> : null}
      <Row label="Reset my preferences" description={hasMine ? "Puts your default firm, phone screens and setup back to the shop's defaults. The shop's settings and your data are untouched." : "You haven't changed any yet; you're on the shop's defaults."} status={rowStatus("reset")}>
        <Button variant="danger-outline" icon={RotateCcw} disabled={!prefsReady || rows.busy.reset || !hasMine || rows.busy.myFirm || rows.busy.phoneMode || rows.busy.setup} onClick={() => setResetting(true)}>Reset my preferences</Button>
      </Row>
    </Card>
    <Card id="set-bills" title="Bills" subtitle="Defaults for new bills, for everyone who signs in" actions={<Badge>Shop-wide</Badge>}>
      {!shop ? <p className="text-sm text-muted pb-2">{whyNot("settings.edit", "change shop-wide settings")}</p> : null}
      <Row label="The shop's default firm" htmlFor="set-firm" description="New bills start with this firm, unless a person picked their own above." status={rowStatus("defaultFirm")}>
        <Select id="set-firm" value={String(rows.value("defaultFirm", "default_business", settings.default_business ?? null) ?? "")} disabled={!shop || rows.busy.defaultFirm}
          onChange={(event) => void rows.shop("defaultFirm", { default_business: event.target.value ? Number(event.target.value) : null })}
          options={[{ value: "", label: "First firm by name" }, ...firms.map((firm) => ({ value: String(firm.id), label: firm.name }))]} />
      </Row>
      <Row label="Copies to print" htmlFor="set-copies" description="What Print picks first. You can still choose at print time." status={rowStatus("copies")}>
        <Select id="set-copies" value={rows.value("copies", "copies", settings.copies)} disabled={!shop || rows.busy.copies}
          onChange={(event) => void rows.shop("copies", { copies: event.target.value as ShopSettings["copies"] })}
          options={[{ value: "original", label: "Original" }, { value: "duplicate", label: "Duplicate" }, { value: "triplicate", label: "Triplicate" }, { value: "all", label: "All three" }]} />
      </Row>
      <div className="py-4 border-t border-rule flex flex-col gap-2">
        <Switch label="Bank details on bills" description="Each firm's bank account prints under the totals, so customers can pay by transfer. Firms without bank details print none."
          checked={rows.value("showBank", "show_bank", settings.show_bank)} disabled={!shop || rows.busy.showBank} onChange={(value) => void rows.shop("showBank", { show_bank: value })} />
        <div className="flex justify-end">{rowStatus("showBank")}</div>
      </div>
      <div className="py-4 border-t border-rule flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><label htmlFor="set-msg" className="font-medium">WhatsApp message with each bill</label>{rowStatus("shareMessage")}</div>
        <p className="text-sm text-muted -mt-2">Sent with the PDF. Words in braces fill in from the bill.</p>
        <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2")}>
          <div className="flex flex-col gap-2">
            <Textarea id="set-msg" ref={messageRef} value={message} disabled={!shop || rows.busy.shareMessage} rows={4} onChange={(event) => setMessage(event.target.value)} invalid={Boolean(problem.error)} aria-describedby="set-msg-help" />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a placeholder">
              {PLACEHOLDERS.map(([placeholder, words]) => <button key={placeholder} type="button" disabled={!shop || rows.busy.shareMessage} onClick={() => insert(placeholder)} title={"Insert " + words.toLowerCase()}
                className={cn("rounded-full border border-line bg-card px-2.5 text-sm tnum text-fg2 hover:text-fg hover:border-muted/50 disabled:opacity-50 transition-colors", isPhone ? "min-h-11" : "h-7")}>{placeholder}</button>)}
            </div>
            <p id="set-msg-help" className={cn("text-sm", problem.error ? "text-neg" : "text-muted")}>{problem.error ?? problem.warning ?? message.length + " of 500 characters"}</p>
            {!problem.error && problem.warning ? <p className="text-sm text-muted">{message.length} of 500 characters</p> : null}
            {(settings.warnings ?? []).filter((warning) => warning !== problem.warning).map((warning) => <p key={warning} role="status" className="text-sm text-muted">{warning}</p>)}
          </div>
          <div className="flex flex-col gap-1.5" aria-live="polite"><span className="caps">Preview · example bill to Anil Gupta</span><p className="rounded-card rounded-tl-sm border border-sale-line bg-sale-tint px-4 py-3 text-fg whitespace-pre-wrap break-words">{problem.error ? "Fix the message to see it." : preview}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!shop || message === savedMessage || Boolean(problem.error)} loading={rows.busy.shareMessage} onClick={() => void rows.shop("shareMessage", { share_message: message })}>Save message</Button>
          {message !== savedMessage ? <Button variant="ghost" onClick={() => setMessage(savedMessage)}>Discard change</Button> : null}
          <Button variant="ghost" disabled={!shop || rows.busy.shareMessage} onClick={() => setMessage(DEFAULT_SHARE_MESSAGE)}>Put back the standard message</Button>
        </div>
      </div>
    </Card>
    <Card id="set-numbering" title="Bill numbers" subtitle="Each firm has its own series, starting again each financial year" pad={false}>
      {isPhone ? <div className="px-4">{firms.map((firm) => <Row key={firm.id} label={firm.name} description={<>Prefix: {firm.invoice_prefix || "None (bare numbers)"} · Last: {firm.numbers?.last ? <BillReference bill={firm.numbers.last} /> : "None yet"} · Next: {firm.numbers?.next.invoice_number ?? "None yet"} · Full number from: {firm.paper_full_number_from ? date(firm.paper_full_number_from) : "Not set"}</>}>
        <ButtonLink to={"/firms/" + firm.id + (can("firm.edit") ? "/edit" : "")} size="sm">{can("firm.edit") ? "Change in " + firm.short + "'s details" : "View " + firm.short}</ButtonLink>
      </Row>)}</div> : <Table label="Bill numbers"><thead><tr><Th>Firm</Th><Th>Prefix</Th><Th>Last bill</Th><Th>Next number</Th><Th>Full number from</Th><Th><span className="sr-only">Firm details</span></Th></tr></thead>
        <tbody>{firms.map((firm) => <Tr key={firm.id}><Td className="font-medium">{firm.name}</Td><Td>{firm.invoice_prefix || "None (bare numbers)"}</Td><Td>{firm.numbers?.last ? <BillReference bill={firm.numbers.last} /> : "None yet"}</Td><Td className="font-semibold text-brand">{firm.numbers?.next.invoice_number ?? "None yet"}</Td><Td>{firm.paper_full_number_from ? date(firm.paper_full_number_from) : "Not set"}</Td><Td><ButtonLink size="sm" variant="ghost" iconRight={ArrowRight} to={"/firms/" + firm.id + (can("firm.edit") ? "/edit" : "")}>{can("firm.edit") ? "Change in " + firm.short + "'s details" : "View " + firm.short}</ButtonLink></Td></Tr>)}</tbody></Table>}
      <p className="px-5 py-4 text-sm text-muted border-t border-rule">Numbers already saved never change. A number typed by hand is checked against the rest.</p>
    </Card>
    <Card id="set-gst" title="GST"><Row label="GST: opening credit" description="Each firm's opening credit, copied from the portal's credit ledger."><ButtonLink to={"/gst?tab=credit" + (shopFirm ? "&firm=" + shopFirm.id : "") + "#opening"}>Open GST settings</ButtonLink></Row></Card>
    {isDesktop ? <Card id="set-keys" title="Keyboard shortcuts" subtitle="They never fire while you type in a field, except Ctrl K and Ctrl S" actions={<Button size="sm" icon={Keyboard} onClick={() => setKeys(true)}>Show all</Button>}>
      <ul className="grid grid-cols-2 gap-x-8">{[[["Ctrl", "K"], "Search customers, bills and pages"], [["Alt", "N"], "New sales bill"], [["Alt", "P"], "New purchase"], [["/"], "Search the list on screen"], [["Ctrl", "S"], "Save the form or bill you're on"], [["Esc"], "Close a dialog or menu"]].map(([keys, words]) => <li key={String(words)} className="flex items-center justify-between gap-4 py-2 border-t border-rule"><span className="text-fg2">{words}</span><span className="flex gap-1">{(keys as string[]).map((key) => <Kbd key={key}>{key}</Kbd>)}</span></li>)}</ul>
    </Card> : null}
    <Card id="set-data" title="Data and setup" subtitle="Backups, the audit log, and the first-run checklist">
      <Row label="Full backup" description="Every year and every firm in one file."><ButtonLink to="/backup" icon={DatabaseBackup}>Backup and restore</ButtonLink></Row>
      <QueryView query={setup} what="the setup checklist">{(data) => <p className="text-sm text-muted">Last full backup: {data.last_backup_at ? date(dayOf(data.last_backup_at)) : "None yet"}.</p>}</QueryView>
      {can("audit.view") ? <Row label="Audit log" description="Who changed what and when, including every shop-wide change on this page."><ButtonLink to="/audit?kind=admin" icon={History}>Open the audit log</ButtonLink></Row> : null}
      <Row label="Run setup again" description="The first-run checklist: your business, a customer, a product, the first bill." status={rowStatus("setup")}><Button icon={Sparkles} disabled={rows.busy.reset || !prefsReady} loading={rows.busy.setup} onClick={async () => { if (await rows.mine("setup", { setup: { dismissed: false, skipped: [] } })) navigate("/setup"); }}>Run setup again</Button></Row>
    </Card>
    <Card id="set-about" title="About"><div className="flex items-start gap-3"><Info size={18} aria-hidden="true" className="text-muted mt-0.5 shrink-0" /><p className="text-fg2">GST Billing, version 3.0.0. {firms.map((firm) => firm.name).join(", ")} on one account. Signed in as {me?.fullName}.</p></div></Card>
  </div>;
  return <>
    {isPhone ? sections : <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8 items-start"><nav aria-label="Settings sections" className="sticky top-6 flex flex-col gap-0.5">{SECTIONS.filter(([id]) => isDesktop || id !== "set-keys").map(([id, label]) => <button key={id} type="button" onClick={() => go(id)} aria-current={current === id ? "true" : undefined} className={cn("text-left px-3 h-9 rounded-ctl transition-colors", current === id ? "bg-brand-sel text-brand font-medium" : "text-fg2 hover:text-fg hover:bg-raised")}>{label}</button>)}</nav>{sections}</div>}
    <ShortcutsDialog open={keys} onClose={() => setKeys(false)} />
    <ConfirmDialog open={resetting} busy={rows.busy.reset} onClose={() => setResetting(false)} onConfirm={async () => { if (await rows.reset()) setResetting(false); }} title="Reset your preferences?" confirmLabel="Reset my preferences" tone="danger" extra={rows.errors.reset ? <p role="alert">{rows.errors.reset}</p> : null}>
      They go back to the shop's defaults. The shop's settings, your data and this device's theme don't change.
    </ConfirmDialog>
    {guard}
  </>;
}
export default function Settings() {
  const { me } = useAuth();
  const settings = useShopSettings();
  const firms = useFirmNumbers();
  return <Page icon={SettingsIcon} title="Settings" back="/more" context="Each setting saves as you change it. The theme is just for this device; “You” follows you; Bills are shop-wide." phoneSubtitle="Each setting saves as you change it">
    <QueryView query={settings} what="settings">{(data) => <QueryView query={firms} what="bill numbers">{(list) => <SettingsBody key={me?.id} person={me?.id ?? 0} settings={data} firms={list} />}</QueryView>}</QueryView>
  </Page>;
}


// Check a printed bill's QR code (PROTO sales/parts.jsx:1134-1190, sales/lib.js:481-511): a phone's camera reads it, a
// computer's USB scanner types it in, or it's pasted. The code's number, firm, date and total are checked against the
// shop's bills on the server: the bill with that number in that firm and year, or the bin when it was deleted. The bills
// list opens the check in a dialog (plan 1B's two slots); /scan holds it on a page (ScanPage, Ruling 1E-7).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf } from "@/core/api/errors";
import { salesParams, type SalesQuery } from "@/core/api/sales";
import { date, fyOf, inr } from "@/core/format";
import { parseQr, type QrText } from "@/core/print/qr";
import { sameNumber } from "@/core/sales/numbers";
import type { BillRow, NumberCheck } from "@/core/sales/types";
import { toNumberCheck, toSalesPage } from "@/core/sales/wire";
import { useFirms, type Firm } from "@/core/scope";
import { Banner, Button, Dialog, Field, Input, type MenuItem } from "@/core/ui";
import { useView } from "@/core/view";

export type QrResult =
  | { kind: "match" | "mismatch" | "cancelled"; q: QrText; firm: Firm; bill: BillRow; diffs: string[] }
  | { kind: "deleted"; q: QrText; firm: Firm; binned: NonNullable<NumberCheck["binned"]> }
  | { kind: "unknown"; q: QrText; firm: Firm }
  | { kind: "otherfirm"; q: QrText }
  | { kind: "unreadable" };

/**
 * Whether a code's total is this bill's: the total to the paisa, as bills print it (Ruling 1B-12), or rounded to the
 * rupee, as v2's printouts carried it until 2 Sep 2026 ("Batch 5: honest UI"): the shop's archive has those.
 */
function sameTotal(code: number, total: number): boolean {
  return code === total || code === Math.round(total / 100) * 100;
}

/**
 * A GSTIN, a firm's name or a bill number without its spaces and line breaks, in capitals: as saved (v2's imports keep a
 * spreadsheet cell's stray space or break) against what a code carries (v3 prints a break as a space; a USB scanner and a
 * paste drop one).
 */
const bare = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** The firms a code names: by GSTIN, so a code with none names the firms saved without one; by name in v2's bulk PDFs' codes. */
function firmsOf(q: QrText, firms: Firm[]): Firm[] {
  return firms.filter((f) => (q.gstin || !q.firm ? bare(f.gstin) === bare(q.gstin) : bare(f.name) === bare(q.firm)));
}

/** A firm's bills with the code's number, in the code's year when it has a date. */
async function billsNumbered(firm: Firm, q: QrText): Promise<BillRow[]> {
  const fy = q.date ? { fy: fyOf(q.date) } : {};
  const ask = async (query: SalesQuery, size: number) => toSalesPage((await api.get("sales/", { params: salesParams(firm.id, { ...query, ...fy, summary: 0 }, 1, size) })).data).results;
  const exact = (await ask({ number: q.number }, 10)).filter((r) => sameNumber(r.invoice_number, q.number));
  if (exact.length) return exact;
  // The server's number is the stored one but for case, so one saved with a stray space or break isn't found from the
  // code's: ask once more for the numbers holding its last digits, shortest first, and keep the one that's the code's
  // but for spaces and breaks. (Only after a miss, so an ordinary code asks once.)
  const digits = /\d+$/.exec(q.number)?.[0];
  return digits ? (await ask({ q: digits, ordering: "number" }, 40)).filter((r) => bare(r.invoice_number) === bare(q.number)) : [];
}

/** What a scanned code says about the shop's bills: the same number in the firm (and year) it names, then the bin. */
export async function checkQr(text: string, firms: Firm[]): Promise<QrResult> {
  const q = parseQr(text);
  if (!q) return { kind: "unreadable" };
  const named = firmsOf(q, firms);
  if (!named.length) return { kind: "otherfirm", q };
  for (const firm of named) {
    const same = await billsNumbered(firm, q);
    // an old code without a date names no year: its total picks the bill
    const bill = same.find((r) => q.total === null || sameTotal(q.total, r.total_amount)) ?? same[0];
    if (!bill) continue;
    const diffs: string[] = [];
    if (q.date && bill.invoice_date !== q.date) diffs.push(`the date is ${date(bill.invoice_date)}, the QR says ${date(q.date)}`);
    if (q.total !== null && !sameTotal(q.total, bill.total_amount)) diffs.push(`the total is ${inr(bill.total_amount)}, the QR says ${inr(q.total)}`);
    return { kind: bill.status === "cancelled" ? "cancelled" : diffs.length ? "mismatch" : "match", q, firm, bill, diffs };
  }
  // not in Sales: the bin says whether the number's bill was deleted (the number check needs the code's date)
  if (q.date) {
    for (const firm of named) {
      const c = toNumberCheck((await api.get("sales/check-number/", { params: { business_id: firm.id, invoice_date: q.date, invoice_number: q.number } })).data);
      if (c.code === "number_deleted" && c.binned) return { kind: "deleted", q, firm, binned: c.binned };
    }
  }
  return { kind: "unknown", q, firm: named[0] };
}

/** "A, B or C", as PROTO names the firms a code isn't. */
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0] ?? "");

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorClass = { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
const detectorClass = () => (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** Whether this browser reads QR codes from the camera (Chrome on Android does; iPhones and most computers don't yet). */
function useCameraReads(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const D = detectorClass();
    if (!D || !navigator.mediaDevices?.getUserMedia) return undefined;
    let live = true;
    D.getSupportedFormats().then((f) => { if (live) setOk(f.includes("qr_code")); }, () => {});
    return () => { live = false; };
  }, []);
  return ok;
}

/**
 * The back camera, looking for a QR code four times a second until it finds one: the device's work, never the
 * server's (only a code found asks it anything). Stops when it's put away, or the check is.
 */
function CameraView({ onText, onFail }: { onText: (t: string) => void; onFail: (why: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const D = detectorClass();
    if (!D) return undefined;
    const detector = new D({ formats: ["qr_code"] });
    let live = true;
    let timer = 0;
    let stream: MediaStream | null = null;
    const look = () => {
      timer = window.setTimeout(() => {
        if (!live || !video.current) return;
        detector.detect(video.current).then((codes) => {
          if (!live) return;
          if (codes[0]?.rawValue) onText(codes[0].rawValue);
          else look();
        }, () => { if (live) look(); });
      }, 250);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      look();
    }, (e: unknown) => { if (live) onFail((e as Error)?.name === "NotAllowedError"
      ? "The camera is blocked for this app. Allow it in the browser's settings, or type what the code says."
      : "The camera didn't start. Type what the code says instead."); });
    return () => { live = false; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one camera for as long as it's on
  return <video ref={video} muted playsInline aria-label="The camera: hold the bill's QR code in the square" className="w-full max-w-[320px] self-center aspect-square object-cover rounded-ctl bg-black" />;
}

/** The same code read again within this long of its last read is answered from the last check, without asking the server again. */
const AGAIN_MS = 5000;
/** How long text that isn't a code waits for the rest of a scan before it's called that (a line break in a code is a USB scanner's Enter). */
const HALF_READ_MS = 300;

/**
 * The check itself, in the list's dialog and on /scan: the camera (where the browser reads codes), the box a USB scanner
 * types into before its Enter, and the answer. input: the box, for the dialog to focus; go: what opening a bill does.
 */
export function QrCheck({ input, go }: { input: RefObject<HTMLInputElement>; go: (to: string) => void }) {
  const qc = useQueryClient();
  const { firms } = useFirms();
  const { isPhone } = useView();
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [cameraFail, setCameraFail] = useState("");
  const cameraReads = useCameraReads();
  // The shop's firms come with the app. Until they have (it opened offline), Check asks for them again, so a code is
  // never called another firm's for want of them. Offline, that ask waits for the internet and the check doesn't: it
  // fails at once in the words of the firms' own failure (a new ask clears it, so it's read first).
  const withFirms = async (t: string): Promise<QrResult> => {
    if (firms.length || !parseQr(t)) return checkQr(t, firms);
    const failed = qc.getQueryState(["firms"])?.error;
    await qc.refetchQueries({ queryKey: ["firms"] }, { cancelRefetch: false });
    const fresh = qc.getQueryData<Firm[]>(["firms"]) ?? [];
    if (!fresh.length) throw qc.getQueryState(["firms"])?.error ?? failed ?? new Error("The firms didn't load");
    return checkQr(t, fresh);
  };
  // Neon's free plan: only a code read asks the server, and the same code again within seconds of its last read (a
  // scanner's second read, a second Enter, the camera held up to it again) gets the answer it had. Each such read renews
  // the seconds, so a bill left under a stand scanner that reads it again and again asks once, not every few seconds. A
  // check that failed is asked again at once.
  const last = useRef<{ text: string; at: number; answer: Promise<QrResult> } | null>(null);
  const check = useMutation({
    mutationFn: (t: string): Promise<QrResult> => {
      const key = t.trim();
      const prev = last.current;
      if (prev && prev.text === key && Date.now() - prev.at < AGAIN_MS) { prev.at = Date.now(); return prev.answer; }
      const answer = withFirms(key);
      last.current = { text: key, at: Date.now(), answer };
      answer.catch(() => { if (last.current?.answer === answer) last.current = null; });
      return answer;
    },
  });
  // Text that isn't a code may be half a read: a code with a line break reaches the scanner's Enter halfway, and the rest
  // follows at once. Its answer waits a moment, and what's typed meanwhile, or the check closing, cancels it.
  const halfRead = useRef(0);
  useEffect(() => () => window.clearTimeout(halfRead.current), []);
  // An answer leaves the code selected in the box, so a USB scanner's next read replaces it rather than adding to it.
  // Not "this isn't a bill's code": the rest of a half read, or of a code half typed, joins it.
  const run = (t = text) => {
    if (!t.trim()) return;
    window.clearTimeout(halfRead.current);
    const ask = () => check.mutate(t, { onSettled: (a) => { if (a?.kind !== "unreadable" && document.activeElement === input.current) input.current?.select(); } });
    if (parseQr(t)) { ask(); return; }
    // (a dialog on its way out keeps its last look: data-closing, as the kit's shortcuts read it)
    halfRead.current = window.setTimeout(() => { if (!input.current?.closest("[data-closing]")) ask(); }, HALF_READ_MS);
  };
  const r = check.data;
  let result: ReactNode = null;
  if (check.isError) {
    const p = problemOf(check.error);
    result = <Banner role="presentation" tone="neg" title={p.kind === "offline" ? "You're offline, so it wasn't checked" : "It wasn't checked"}>{p.kind === "offline" ? "The check asks the shop's records, which need the internet. Try again when it's back." : p.kind === "unreachable" || p.kind === "server" ? "The app couldn't get through. Try again in a minute." : p.message}</Banner>;
  } else if (r) {
    result = r.kind === "match" ? (
      <Banner role="presentation" tone="sale" title={`Matches ${r.bill.invoice_number}`} actions={<Button size="sm" variant="primary" onClick={() => go(`/sales/${r.bill.id}`)}>Open the bill</Button>}>
        {r.firm.name} · {r.bill.customer.name} · {date(r.bill.invoice_date)} · {inr(r.bill.total_amount)}. The bill is genuine and unchanged.
      </Banner>
    ) : r.kind === "mismatch" ? (
      <Banner role="presentation" tone="neg" title={`${r.bill.invoice_number} doesn't match the QR code`} actions={<Button size="sm" onClick={() => go(`/sales/${r.bill.id}`)}>Open the bill</Button>}>
        On your records {r.diffs.join("; ")}. The printout may have been changed, or the bill edited after printing.
      </Banner>
    ) : r.kind === "cancelled" ? (
      <Banner role="presentation" tone="neg" title={`${r.bill.invoice_number} is cancelled`} actions={<Button size="sm" onClick={() => go(`/sales/${r.bill.id}`)}>Open the bill</Button>}>
        The QR code is real, but the bill was cancelled{r.bill.cancel_reason ? `: “${r.bill.cancel_reason}”` : ""}. It isn&apos;t a valid sale.
      </Banner>
    ) : r.kind === "deleted" ? (
      <Banner role="presentation" tone="brand" title={`${r.binned.invoice_number} was deleted`} actions={<Button size="sm" onClick={() => go(`/sales/${r.binned.original_id}`)}>Open it</Button>}>
        {r.binned.reason ? `Deleted because “${r.binned.reason}”. ` : ""}Its page shows what was on it, and the owner can restore it from there.
      </Banner>
    ) : r.kind === "unknown" ? (
      <Banner role="presentation" tone="neg" title={`No bill ${r.q.number} in ${r.firm.name}`}>
        The QR code names {r.firm.name}, but no bill with this number exists{r.q.date ? ` in FY ${fyOf(r.q.date)}` : ""}. It may not be one of yours.
      </Banner>
    ) : r.kind === "otherfirm" ? (
      <Banner role="presentation" tone="neg" title="Not one of your firms">
        {r.q.gstin || r.q.firm
          ? <>The QR code carries {r.q.gstin ? `GSTIN ${r.q.gstin}` : `the firm “${r.q.firm}”`}, which isn&apos;t {orList(firms.map((f) => f.name)) || "a firm of yours"}.</>
          : "The QR code carries no GSTIN, and all your firms have one."}
      </Banner>
    ) : (
      <Banner role="presentation" tone="neg" title="This isn't a bill's QR code">Your bills&apos; QR codes carry number, GSTIN, date and total separated by &quot;|&quot;. Scan again, holding the code flat.</Banner>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {camera || cameraReads ? (
        <Button icon={camera ? CameraOff : Camera} full={isPhone} className={isPhone ? "" : "self-start"}
          onClick={() => { if (camera) { setCamera(false); return; } window.clearTimeout(halfRead.current); setCameraFail(""); check.reset(); setCamera(true); }}>{camera ? "Stop the camera" : "Scan with the camera"}</Button>
      ) : null}
      {camera ? <CameraView onText={(t) => { setCamera(false); setText(t); run(t); }} onFail={(why) => { setCamera(false); setCameraFail(why); }} /> : null}
      {cameraFail ? <p role="alert" className="text-sm text-neg">{cameraFail}</p> : null}
      <Field label="Or type or paste what it says" htmlFor="qr-text" hint="A USB scanner types it here and presses Enter. It reads like bill number|GSTIN|date|total.">
        <div className="flex gap-2">
          <Input ref={input} id="qr-text" value={text} className="flex-1" inputClassName="tnum" autoComplete="off" spellCheck={false}
            onChange={(e) => { window.clearTimeout(halfRead.current); setText(e.target.value); check.reset(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }} />
          <Button variant="primary" icon={ScanLine} loading={check.isPending} onClick={() => run()}>{check.isPending ? "Checking…" : "Check"}</Button>
        </div>
      </Field>
      <div role="status" aria-live="polite" aria-atomic="true">{result ? <div className="anim-rise">{result}</div> : null}</div>
    </div>
  );
}

/**
 * The check in a dialog, for the bills list. It draws the check only while it's open, so each opening starts afresh:
 * an empty box, the camera off.
 */
export function QrCheckDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Check a bill's QR code" size="md" initialFocus={input}
      description="The app checks the number, firm, date and total on a printed bill against your bills.">
      <QrCheck input={input} go={(to) => { onClose(); navigate(to); }} />
    </Dialog>
  );
}

/** The list's header button on a desktop (plan 1B's DesktopList puts it first in its actions). */
export function QrCheckButton() {
  const [open, setOpen] = useState(false);
  return <><Button icon={ScanLine} onClick={() => setOpen(true)}>Check a QR code</Button><QrCheckDialog open={open} onClose={() => setOpen(false)} /></>;
}

/** The phone list's ⋯ menu item and its dialog (plan 1B's PhoneList puts the item first and draws the dialog). */
export function useQrCheck(): { item: Extract<MenuItem, { label: string }>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  return {
    item: { label: "Check a QR code", hint: "Scan a printed bill to see if it's real", icon: ScanLine, onSelect: () => setOpen(true) },
    dialog: <QrCheckDialog open={open} onClose={() => setOpen(false)} />,
  };
}

// The bill form's state, and everything it works out as you type (PROTO pages/sales/useBillForm.js): the figures to the
// paisa as the server works them out, the number (the paper bill's, typed or the next one confirmed), the date the firm's months allow, the
// place of supply, the problems under each field, the checks beside the total, and the save. The server is the truth:
// what it says about a number, a closed month or a line comes back under the field it names. Both the desktop and the
// phone form run on this hook.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCustomer, type Customer } from "@/core/api/customers";
import { draftSettled, forgetDraft, newDraftId } from "@/core/api/drafts";
import { lineErrors, linesErrors, problemOf, type ApiProblem } from "@/core/api/errors";
import { useRates } from "@/core/api/dashboard";
import { useNetwork } from "@/core/api/network";
import { invalidateSales, salesKeys, useCheckNumber, useCreateBill, useNextNumber, usePaperBook, useSalesMonths, useSalesPage, useUpdateBill } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { addMonths, fyOf, monthLabel, monthOf, todayIST } from "@/core/format";
import { GST_STATES } from "@/core/ids";
import { markFresh } from "@/core/sales/fresh";
import { itaxFlags } from "@/core/sales/itax";
import { billFigures } from "@/core/sales/maths";
import { counterOf } from "@/core/sales/numbers";
import { autoPos, gstinNote, taxType } from "@/core/sales/pos";
import type { PaymentMode } from "@/core/sales/types";
import { toBillRef } from "@/core/sales/wire";
import { failText, type FailText } from "@/core/sales/words";
import { useFirms } from "@/core/scope";
import { useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { focusNow } from "./fields";
import { blankLine, hasContent, posCustomer, slabOf, stateOf, storedFor, toBillInput, type FormLine, type FormState, type Start } from "./model";
import { lastPaperDate, rememberPaperDate } from "./paperDates";
import { changesOf, checkedNumber, checksOf, dateProblem, dateWarning, errorOrder, firmHint, formErrors, numberProblem, prevFy, type Locked, type NumberState } from "./rules";

/**
 * Why a save didn't happen, said once at the top of the review. next: a number to save as instead (a clash). link: the
 * way on, a bill: the one this unfinished bill became already (draft_saved: the server made none this time), or the
 * bill being changed, cancelled (cancelled) or deleted (gone: the PUT's 404) meanwhile. draft_saved, cancelled, gone and
 * replaces (the server refused the cancelled bill this one makes again) can't change by saving again: the review offers
 * no Try again (Ruling 1D-12).
 */
export type SaveError = FailText & {
  kind: "payment" | "cash" | "clash" | "filed" | "offline" | "failed" | "draft_saved" | "cancelled" | "gone" | "replaces";
  next?: string;
  link?: { label: string; to: string };
};

/**
 * How a save that was on its way ended: saved; refused as a bill was made from its draft already (409 draft_saved); or
 * failed otherwise. A form left meanwhile keeps what was typed as a draft only when it failed (Ruling 1D-10).
 */
export type SaveEnd = "saved" | "draft_saved" | "failed";

/** The server's field names, as the form's keys for the problem under each field. */
const FIELD_KEY: Record<string, string> = { business: "firm", invoice_number: "number", invoice_date: "date", customer: "customer", place_of_supply: "pos", notes: "notes" };
const LINE_KEY: Record<string, string> = { product_name: "product", hsn_code: "hsn", gst_percent: "gst", quantity: "qty", unit: "qty", rate: "rate", note: "note" };
/** What the server refused, under the form's keys: a line's by its place among the lines sent (contract §1, DRF 3.18). */
export function serverErrorsOf(p: ApiProblem | null, sent: FormLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!p) return out;
  for (const [k, v] of Object.entries(p.fields ?? {})) if (FIELD_KEY[k]) out[FIELD_KEY[k]] = v;
  const whole = linesErrors(p);
  if (whole.length) out.lines = whole[0];
  sent.forEach((l, i) => {
    for (const [field, key] of Object.entries(LINE_KEY)) {
      const words = lineErrors(p, i, field);
      if (words.length && !out[`${l.key}-${key}`]) out[`${l.key}-${key}`] = words[0];
    }
  });
  return out;
}

export function useBillForm(start: Start, formKey?: string) {
  const { can, whyNot } = useAuth();
  const { firms } = useFirms();
  const net = useNetwork();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show } = useToast();
  const today = todayIST();
  const edit = start.mode === "edit";
  const bill = start.bill;

  const [f, setF] = useState<FormState>(start.form);
  const fRef = useRef(f);
  fRef.current = f;
  const [tried, setTried] = useState(start.tried);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [serverProblem, setServerProblem] = useState<ApiProblem | null>(null);
  // A failed refresh cannot overrule a save's refusal. Keep it with the number or month it names.
  const [numberRefusal, setNumberRefusal] = useState<{ business: number | null; fy: string; number: string; message: string } | null>(null);
  const [monthRefusal, setMonthRefusal] = useState<{ business: number | null; month: string; message: string } | null>(null);
  const [cashAnyway, setCashAnyway] = useState(false);
  const [newKeys, setNewKeys] = useState<Set<string>>(() => new Set());
  const [draftId, setDraftId] = useState<string | null>(start.draftId);
  const [bookDate, setBookDate] = useState(start.bookDate);
  const [saving, setSaving] = useState(false);
  /** Where to go once saved; the form lets its leave-guard go first (useFormExit). */
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const reading = !saving && !savedTo;
  /** The save on its way, as it will end: told to a form that was left before the answer came. */
  const saveEnd = useRef<Promise<SaveEnd> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /* ── setters: any change clears what the server last refused ── */
  const set = useCallback((patch: Partial<FormState> | ((o: FormState) => Partial<FormState>)) => {
    // A day typed or picked wins over a paper book still on its way.
    if (typeof patch !== "function" && "date" in patch) setBookDate(false);
    setSaveError(null);
    setServerProblem(null);
    setF((o) => ({ ...o, ...(typeof patch === "function" ? patch(o) : patch) }));
  }, []);
  const setLine = useCallback((key: string, patch: Partial<FormLine> | ((l: FormLine) => Partial<FormLine>)) => {
    setSaveError(null);
    setServerProblem(null);
    setF((o) => ({ ...o, lines: o.lines.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)) }));
  }, []);
  /**
   * Adds a line (or a filled one from the phone's item sheet); an empty last line is reused, not doubled. With focus, the
   * new line is drawn now (flushSync) and its product box takes focus inside the key press, so a fast typist's next keys land there.
   */
  const addLine = useCallback((focus = true, line?: FormLine): string => {
    const cur = fRef.current.lines;
    const last = cur[cur.length - 1];
    if (!line && last && !hasContent(last)) { if (focus) focusNow(`bf-${last.key}-product`); return last.key; }
    const l = line ?? blankLine();
    const replaceBlank = Boolean(line) && cur.length === 1 && !hasContent(cur[0]);
    const apply = () => {
      setF((o) => ({ ...o, lines: replaceBlank ? [l] : [...o.lines, l] }));
      setNewKeys((s) => new Set([...s, l.key]));
    };
    if (focus) { flushSync(apply); focusNow(`bf-${l.key}-product`); } else apply();
    return l.key;
  }, []);
  /** Removes a line, saying so with Undo (also Ctrl Z for 30 s). */
  const removeLine = useCallback((key: string) => {
    const cur = fRef.current.lines;
    const at = cur.findIndex((l) => l.key === key);
    const removed = cur[at];
    setF((o) => { const rest = o.lines.filter((l) => l.key !== key); return { ...o, lines: rest.length ? rest : [blankLine()] }; });
    if (removed && hasContent(removed)) {
      show({ tone: "brand", title: `Removed ${removed.name}`, body: "The total no longer includes it.", action: { label: "Undo", onClick: () => setF((o) => {
        const lines = o.lines.length === 1 && !hasContent(o.lines[0]) ? [] : [...o.lines];
        lines.splice(Math.min(at, lines.length), 0, removed);
        return { ...o, lines };
      }) } });
    }
  }, [show]);

  /* ── the firm, the customer and where the supply is taxed ── */
  const firm = firms.find((x) => x.id === f.firmId) ?? null;
  const firmName = firm?.name ?? (bill && f.firmId === bill.business ? bill.business_name : "");
  const firmState = (firm && stateOf(firm.gstin, firm.state)) || (bill && f.firmId === bill.business ? bill.firm.state_code : "");
  // the customer as saved now (a PAN or address added from the bill shows at once), else as picked
  const live = useCustomer(f.customer?.id ?? null, reading);
  const cust: Customer | null = live.data && live.data.id === f.customer?.id ? live.data : f.customer;
  const pc = posCustomer(cust);
  // a place GST's table doesn't have (a GSTIN starting "28" or "00") is asked for, never quietly the firm's
  const placed = autoPos(firmState, pc);
  const auto = GST_STATES[placed] ? placed : "";
  // null: where the form would put it anyway; "": delivered to another state, not chosen yet
  const pos = f.posOverride != null ? f.posOverride : auto;
  const tt = taxType(firmState, pos, pc);
  const setCustomer = useCallback((c: Customer) => set({ customer: c, posOverride: null }), [set]);
  const setFirm = useCallback((id: number) => {
    // a paper bill's number follows the firm's own paper book
    if (fRef.current.paper && !edit) set({ firmId: id, number: "", numberTyped: false });
    else set({ firmId: id });
  }, [set, edit]);

  /* ── the figures, to the paisa as the server works them out ── */
  const filled = f.lines.filter(hasContent);
  const sig = JSON.stringify(filled.map((l) => [l.key, l.qty, l.rate, l.gst])) + tt.inter;
  // a line's tax waits for its GST rate: none chosen yet, or one that isn't a slab (v2's 7%, which the server refuses)
  const figs = useMemo(() => billFigures(filled.map((l) => ({ quantity: l.qty ?? "", rate: l.rate, gst_percent: slabOf(l.gst) || "0" })), tt.inter), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineFig = (key: string) => figs.lines[filled.findIndex((l) => l.key === key)] ?? null;

  /* ── the number: the paper bill's, typed, or the next one confirmed ── */
  const moved = Boolean(edit && bill && (f.firmId !== bill.business || fyOf(f.date || bill.invoice_date) !== bill.fy));
  const keep = Boolean(edit && bill && !moved && !f.numberTyped);
  const fyNow = fyOf(today);
  // A partially typed year (28/09/20) isn't a bill date this form can save. A cleared date asks for no book.
  const settledDate = useDebounced(f.date, 300);
  const allowedDate = (iso: string) => Boolean(iso) && iso <= today && [fyNow, prevFy(fyNow)].includes(fyOf(iso));
  const dateAllowed = allowedDate(f.date);
  const dateWaiting = dateAllowed && f.date !== settledDate;
  const queryDate = allowedDate(settledDate) ? settledDate : "";
  const dateReady = Boolean(queryDate) && queryDate === f.date;
  const ratesDateReady = dateReady || (edit && bill?.invoice_date === f.date && f.date === settledDate);
  const ratesQuery = useRates(f.date || undefined, reading && ratesDateReady);
  const nextFor = [keep ? null : f.firmId, keep ? "" : queryDate] as const;
  const next = useNextNumber(...nextFor, reading && dateReady);
  const bookFor = [f.paper && !edit ? f.firmId : null, f.paper && !edit && queryDate ? monthOf(queryDate) : null] as const;
  const book = usePaperBook(...bookFor, reading && dateReady);
  // An answer a write has marked since it came (invalidateSales; a refresh that fails leaves it so) may be older than a
  // bill just saved: its next number may be that bill's, and a check may call that number free. It's no answer until a
  // fresh one comes, as the paper book's Enter bill waits (T7 re-review). A customer saved from the form marks every bill
  // query too: the number then waits for its fresh answer, and the review holds Save till it comes (Ruling 1D-15)
  const current = (key: QueryKey) => !qc.getQueryState(key)?.isInvalidated;
  const nextNow = dateReady && next.data && current(salesKeys.nextNumber(...nextFor)) ? next.data : undefined;
  const bookNow = f.date && monthOf(f.date) === monthOf(queryDate) && book.data && current(salesKeys.paperBook(...bookFor)) ? book.data : undefined;
  const suggestion = f.paper && !edit ? (bookNow && !bookNow.locked ? String(bookNow.next.counter) : "") : nextNow ? String(nextNow.counter) : "";
  // Keep the last suggestion visible through the date's debounce; waitingForNext still holds Save for its fresh answer.
  const pendingNumber = dateWaiting ? (f.paper && !edit ? book.data?.next.counter : next.data?.counter) : undefined;
  const numberText = keep && bill ? bill.invoice_number : f.numberTyped ? f.number : suggestion || (pendingNumber === undefined ? "" : String(pendingNumber));
  // (a firm's format doesn't change with a save: an older answer gives it as well as a fresh one)
  const stored = keep && bill ? bill.invoice_number : storedFor(next.data, numberText);
  const typedNow = useDebounced(f.numberTyped && !keep ? f.number.trim() : "", 300);
  const checkFor = typedNow && f.firmId !== null && queryDate ? { business: f.firmId, invoice_date: queryDate, invoice_number: typedNow, ...(edit && bill ? { exclude_id: bill.id } : {}) } : null;
  const check = useCheckNumber(checkFor, reading && dateReady);
  // the server's answer for what's typed now; one that checked nothing is no answer either way (contract §2.12), nor is
  // one from before a save
  const answer = dateReady && f.numberTyped && typedNow === f.number.trim() && current(salesKeys.checkNumber(checkFor)) ? check.data ?? null : null;
  const known = checkedNumber(answer);
  const refusedNumber = numberRefusal?.business === f.firmId && numberRefusal.fy === fyOf(f.date) ? numberRefusal : null;
  useEffect(() => { if (known?.code === "" && refusedNumber?.number === stored) setNumberRefusal(null); }, [known, refusedNumber, stored]);
  // no number yet, with the next one being asked for: the first answer, or a fresh one in place of one a write marked.
  // Nothing is wrong with it meanwhile: it's coming (Ruling 1D-15)
  const waitingForNext = !keep && !f.numberTyped && !suggestion && net !== "offline"
    && (dateWaiting || (f.paper && !edit ? book.isFetching && !bookNow : next.isFetching && !nextNow));
  const numberError = (!known && refusedNumber?.number === stored ? refusedNumber.message : "")
    || (keep || waitingForNext ? "" : numberProblem(numberText, nextNow?.invoice_number ?? "", stored) || (known?.code ? known.problem : ""));
  const numberNote = !numberError && known?.note ? known.note : "";
  // "checking" only while a check is coming: typing hasn't paused yet, the server hasn't answered, or a fresh answer is on
  // its way in place of one from before a save. One that failed (a 500, the network) or can't be sent (no firm, or no
  // date it could read) is no answer, like an unchecked one: the number is checked when the bill saves, never "Checking…"
  // for ever (T4 re-review)
  const asking = f.numberTyped && !keep && f.firmId !== null && dateAllowed && Boolean(f.number.trim()) && net !== "offline"
    && (dateWaiting || typedNow !== f.number.trim() || check.isPending || (check.isFetching && !answer));
  const numberState: NumberState = keep || (!f.numberTyped && suggestion) || known?.code === "" ? "free" : waitingForNext ? "waiting" : asking && !answer ? "checking" : "unknown";
  const setNumber = useCallback((text: string) => set({ number: text, numberTyped: true }), [set]);
  const takeSuggestion = useCallback(() => set({ number: "", numberTyped: false }), [set]);

  /* ── the date: the firm's closed months (contract: the facets' `locked`) ── */
  const facetsNow = useSalesMonths(f.firmId, fyNow, reading);
  const lastFyAsked = Boolean(queryDate) && fyOf(queryDate) === prevFy(fyNow);
  const facetsLast = useSalesMonths(lastFyAsked ? f.firmId : null, prevFy(fyNow), reading);
  // An edit may be refused for its old firm's month. Usually this shares the current months query; otherwise it asks for that month’s FY.
  const refusedFy = monthRefusal ? fyOf(`${monthRefusal.month}-01`) : fyNow;
  const refusedMonths = useSalesMonths(monthRefusal?.business ?? null, refusedFy, reading);
  const monthOpened = Boolean(monthRefusal && current(salesKeys.months(monthRefusal.business, refusedFy))
    && refusedMonths.data?.some((m) => m.month === monthRefusal.month && !m.locked));
  useEffect(() => { if (monthOpened) setMonthRefusal(null); }, [monthOpened]);
  const months = useMemo(() => [...(facetsNow.data ?? []), ...(facetsLast.data ?? [])], [facetsNow.data, facetsLast.data]);
  const locked: Locked = useCallback((ym) => months.some((m) => m.month === ym && m.locked)
    || Boolean(!monthOpened && monthRefusal?.business === f.firmId && monthRefusal.month === ym), [months, monthOpened, monthRefusal, f.firmId]);
  const lockKnown = useCallback((ym: string) => months.some((m) => m.month === ym), [months]);
  const refusedDate = !monthOpened && monthRefusal && ((monthRefusal.business === f.firmId && monthRefusal.month === monthOf(f.date))
    || (edit && bill && monthRefusal.business === bill.business && monthRefusal.month === monthOf(bill.invoice_date))) ? monthRefusal.message : "";
  const dateError = refusedDate || (edit && bill && f.date === bill.invoice_date ? "" : dateProblem({ iso: f.date, today, firmName, locked, known: lockKnown, paper: f.paper && !edit }));
  const dateWarn = dateError ? "" : dateWarning(f.date, today, nextNow?.invoice_number ?? "");
  /** A day the calendar can't take, and why (PROTO parts.jsx:851-856). */
  const offReason = useCallback((iso: string) => {
    if (iso > today) return "after today";
    if (iso < `${prevFy(fyNow).slice(0, 4)}-04-01`) return "before last year";
    return locked(monthOf(iso)) ? `${monthLabel(monthOf(iso), { long: true })} is filed` : "";
  }, [today, fyNow, locked]);
  // a paper bill opened without a date takes the paper book's next date, once
  useEffect(() => {
    if (!bookDate || !book.data) return;
    setBookDate(false);
    if (book.data.next.invoice_date) setF((o) => ({ ...o, date: book.data!.next.invoice_date }));
  }, [bookDate, book.data]);
  /** "Copying a paper bill" on: its own number and date (this firm's last paper date this visit, else the paper book's); off: today and the next number. */
  const setPaper = useCallback((on: boolean) => {
    const o = fRef.current;
    if (on) {
      const remembered = lastPaperDate(o.firmId);
      set({ paper: true, number: "", numberTyped: false, date: remembered || `${addMonths(monthOf(today), -1)}-01` });
      setBookDate(!remembered);
    } else {
      set({ paper: false, number: "", numberTyped: false, date: today });
      setBookDate(false);
    }
  }, [set, today]);
  /** "Same as last bill": this visit's last paper bill for the firm, else the bill numbered just below this one in the month. */
  const lastPaperDay = useMemo(() => {
    const remembered = lastPaperDate(f.firmId);
    if (remembered) return remembered;
    const n = counterOf(numberText);
    if (n == null) return "";
    const below = (book.data?.bills ?? []).filter((b) => b.status !== "cancelled" && b.counter != null && b.counter < n).pop();
    return below?.invoice_date ?? "";
  }, [f.firmId, numberText, book.data]);

  /* ── problems under each field: the form's own, and what the server last refused ── */
  const serverErrors = useMemo(() => serverErrorsOf(serverProblem, filled), [serverProblem]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors: Record<string, string> = { ...formErrors({ f, numberError, dateError, pos }), ...serverErrors };
  const firstError = errorOrder(f.lines).find((k) => errors[k]) ?? null;
  /**
   * Problems show after a save is tried; the number and the date as they're typed; a line's HSN and GST once left. A
   * number box nothing could fill yet (offline, or the next number didn't come) and nobody has typed in says what to
   * type, and waits for Check and save to mark it.
   */
  const showErr = (k: string): string => {
    if (!errors[k]) return "";
    if (tried || serverErrors[k]) return errors[k];
    if (k === "number") return waitingForNext || (!f.numberTyped && !suggestion) ? "" : errors[k];
    if (k === "date") return touched.date ? errors[k] : "";
    if ((k.endsWith("-gst") || k.endsWith("-hsn")) && touched[k]) return errors[k];
    return "";
  };

  /* ── income tax, a bill maybe made twice, and the checks beside the total ── */
  const itax = cust ? itaxFlags({ status: "active", payment_mode: f.payment ?? "", total: figs.total, taxable: figs.taxable, customer: { name: cust.name, type: cust.type, pan: cust.pan, gst_number: cust.gst_number, address: cust.address } }) : [];
  const cashOver = itax.some((x) => x.kind === "cash_limit");
  const cashBlock = cashOver && !cashAnyway;
  const twinAsked = !edit && Boolean(cust) && cust?.type !== "walkin" && figs.total > 0 && Boolean(f.date) && !dateError;
  const sameDay = useSalesPage(f.firmId, { customer_id: cust?.id, start_date: f.date, end_date: f.date, summary: 0 }, 10, twinAsked && reading);
  const twinRow = twinAsked ? (sameDay.data?.results ?? []).find((b) => b.status !== "cancelled" && b.total_amount === figs.total) : undefined;
  const twin = twinRow ? { invoice_number: twinRow.invoice_number, total: twinRow.total_amount } : null;
  const checks = checksOf({
    mode: start.mode, paper: f.paper && !edit, f, customer: cust, today, stored, numberError, numberState, saved: bill?.invoice_number ?? "", moved,
    dateError, dateWarn, nextNumber: nextNow?.invoice_number ?? "", locked, pos, taxShort: tt.short, taxWhy: tt.why, itax,
    gstinNote: cust && cust.type !== "walkin" ? gstinNote(cust.gst_number) : "", twin, total: figs.total,
  });
  const canMove = can("bill.edit");
  const hint = firmHint({ mode: start.mode, source: start.firmSource, paper: f.paper && !edit, canMove, moving: moved && bill && f.firmId !== bill.business ? `Moves the bill to ${firmName} as ${stored || "its new number"}. ${bill.invoice_number} is left unused.` : "" });

  /* ── editing: what changes, and whether anything has ── */
  const changes = edit && bill ? changesOf(bill, f, { firmName, number: waitingForNext ? "Getting the next number" : stored || "—", pos, inter: tt.inter, total: figs.total, customerName: cust?.name ?? "" }) : [];
  const dirty = changes.length > 0;
  // the customer has the bill already, and a change changes its total: the saved page offers to send the corrected one.
  // Never for a bill nothing was changed on, whose stored total v3's maths puts a paisa off (Ruling 1D-16)
  const sentNote = edit && bill?.sent && changes.length > 0 && bill.total_amount !== figs.total ? bill : null;

  /* ── review and save ── */
  const openReview = useCallback((): { ok: true } | { ok: false; first: string } => {
    setTried(true);
    if (firstError) return { ok: false, first: firstError };
    setCashAnyway(false);
    setSaveError(null);
    setReviewOpen(true);
    return { ok: true };
  }, [firstError]);
  const closeReview = useCallback(() => { if (saving) return; setReviewOpen(false); setSaveError(null); }, [saving]);
  const setPayment = useCallback((p: PaymentMode) => set({ payment: p }), [set]);
  const create = useCreateBill();
  const update = useUpdateBill();
  /** Saves from the review. Resolves with the first field the server refused, for the form to take the person to (null otherwise). */
  const save = async ({ numberOverride }: { numberOverride?: string } = {}): Promise<{ refused: string | null }> => {
    const none = { refused: null };
    if (saving || !reviewOpen || waitingForNext) return none;
    // The offered next number replaces only the old number's error. A deliberate retry can ask whether the owner unlocked a refused month.
    const override = numberOverride === undefined ? null : storedFor(next.data, numberOverride);
    const first = errorOrder(f.lines).find((k) => k === "number" && override !== null
      ? numberProblem(numberOverride!, nextNow?.invoice_number ?? "", override) || (refusedNumber?.number === override ? refusedNumber.message : "")
      : k === "date" && refusedDate && saveError ? false : errors[k]);
    if (first) { setReviewOpen(false); return { refused: first }; }
    if (f.payment == null) { setSaveError({ kind: "payment", title: "How was it paid?", body: "Pick one above: it goes on the bill and in your cash and bank split." }); return none; }
    if (cashBlock) { setSaveError({ kind: "cash", title: "Cash of ₹2,00,000 or more", body: "Switch to Part cash, part UPI, or tick that you're saving it as all cash anyway." }); return none; }
    // only an edit gets here offline: a new bill's review turns Save off and says where the bill is kept (offlineNew)
    if (net === "offline") { setSaveError({ kind: "offline", ...failText({ kind: "offline", message: "" }) }); return none; }
    const number = numberOverride ?? numberText;
    // only a new bill takes an unfinished bill with it (toBillInput sends draft_id on a POST only)
    const draft = edit ? null : draftId ?? newDraftId();
    const body = toBillInput(f, { mode: start.mode, pos, number, draftId: draft, replaces: start.replaces });
    flushSync(() => {
      setSaving(true);
      setSaveError(null);
      if (draft && !draftId) setDraftId(draft);
    });
    if (draft && !draftId) navigate(`/sales/new?draft=${draft}`, { replace: true, state: { formKey } });
    let ended: (how: SaveEnd) => void = () => {};
    saveEnd.current = new Promise<SaveEnd>((r) => { ended = r; });
    try {
      // a keep of the draft still on its way could make it again after the bill takes it: the POST goes once it has landed (Task 1)
      if (draft) await draftSettled(draft);
      const d = edit && bill ? await update.mutateAsync({ id: bill.id, body }) : await create.mutateAsync(body);
      // the bill is saved, whatever has happened to this page meanwhile: its draft leaves this device and the shop's list
      if (draft) forgetDraft(qc, draft);
      ended("saved");
      if (!edit && f.paper) rememberPaperDate(f.firmId, f.date);
      markFresh(d.id);
      // React Router's navigate works after the form is gone (part 0 carry): only a form still showing moves on
      if (!mounted.current) {
        show({ title: `Saved ${d.invoice_number}`, body: `${d.customer.name} · the bill is in Sales.`, action: { label: "Open", onClick: () => navigate(`/sales/${d.id}`) } });
        return none;
      }
      setSavedTo(`/sales/${d.id}?saved=${edit ? "edit" : "new"}`);
      return none;
    } catch (e) {
      const p = problemOf(e);
      // a bill was made from this draft already (on another counter, or by a save whose answer was lost): the server made
      // none now, and the draft is let go everywhere, whatever has happened to this page meanwhile. The form keeps its
      // draft_id, so trying again can never make a second bill (Ruling 1D-8). That bill is new to this tab, which heard
      // nothing of it (a lost answer marks nothing): every bill query asks again, so neither the paper book nor the next
      // number offers its number (T7 re-review)
      if (p.code === "draft_saved") {
        if (draft) forgetDraft(qc, draft);
        invalidateSales(qc);
      }
      ended(p.code === "draft_saved" ? "draft_saved" : "failed");
      if (!mounted.current) return none;
      const month = f.date ? monthLabel(monthOf(f.date), { long: true }) : "The month";
      if (p.code === "draft_saved") {
        const said = (p.body as { bill?: unknown } | undefined)?.bill;
        const made = said && typeof said === "object" ? toBillRef(said) : null;
        setSaveError({ kind: "draft_saved", ...failText(p), ...(made?.id ? { link: { label: `Open ${made.invoice_number}`, to: `/sales/${made.id}` } } : {}) });
      } else if (p.code === "number_taken" || p.code === "number_deleted") {
        const n = (p.body as { next?: { invoice_number?: string } } | undefined)?.next?.invoice_number ?? "";
        const shown = numberOverride ? storedFor(next.data, numberOverride) : stored;
        // the paper bill's own number never changes by itself: only a suggested number is offered the next free one
        const offer = !f.numberTyped && !(f.paper && !edit) && !keep ? n : "";
        setNumberRefusal({ business: f.firmId, fy: fyOf(f.date), number: shown, message: p.message });
        setSaveError({ kind: "clash", title: p.code === "number_taken" ? `${shown} was just used` : `${shown} belonged to a deleted bill`, body: `${p.message} Check the number on the paper bill.`, next: offer || undefined });
        void qc.invalidateQueries({ queryKey: salesKeys.checkNumber(checkFor) });
        void qc.invalidateQueries({ queryKey: salesKeys.nextNumber(...nextFor) });
      } else if (p.code === "month_closed") {
        // the month the server names: a change is refused for the bill's old month or its new one, whichever is filed
        // (contract §2.3), so the date's month alone could name the wrong one
        const at = (p.body as { locked_period?: { business?: unknown; year?: unknown; month?: unknown } } | undefined)?.locked_period;
        const y = Number(at?.year);
        const m = Number(at?.month);
        const filed = y > 0 && m >= 1 && m <= 12 ? monthLabel(`${y}-${String(m).padStart(2, "0")}`, { long: true }) : month;
        const business = Number(at?.business) || f.firmId;
        setMonthRefusal({ business, month: y > 0 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : monthOf(f.date), message: p.message });
        setSaveError({ kind: "filed", title: `${filed} was just filed`, body: p.message });
        void qc.invalidateQueries({ queryKey: ["sales", "months", business] });
      } else if (p.code === "cancelled" && bill) {
        // cancelled while it was being changed (a PUT): the bill itself is the way on, where it can be made again
        setSaveError({ kind: "cancelled", ...failText(p), link: { label: `Open ${bill.invoice_number}`, to: `/sales/${bill.id}` } });
      } else if (p.kind === "notfound" && edit && bill) {
        // deleted while it was being changed (the PUT's 404, whose own words name nothing): said by name, in the server's
        // words when it sends its own. The bill's page says where it is, and is where the owner restores it
        const said = p.code === "deleted" ? (p.body as { detail?: unknown } | undefined)?.detail : undefined;
        const body = typeof said === "string" && said ? said : `${bill.invoice_number} isn't in Sales any more. Someone deleted it while you were changing it, so nothing was saved.`;
        setSaveError({ kind: "gone", title: "Not saved", body, link: { label: `Open ${bill.invoice_number}`, to: `/sales/${bill.id}` } });
      } else {
        // what the server refused under a field the form has goes there, and the review closes for it; a refusal of
        // something the form has no field for (replaces, draft_id, payment_mode) stays in the review, in its words
        const refused = p.kind === "validation" ? serverErrorsOf(p, filled) : {};
        const first = errorOrder(f.lines).find((k) => refused[k]) ?? null;
        if (first) {
          setServerProblem(p);
          setTried(true);
          setReviewOpen(false);
          return { refused: first };
        }
        setSaveError({ kind: p.fields?.replaces ? "replaces" : "failed", ...failText(p) });
      }
      return none;
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return {
    rates: ratesDateReady ? ratesQuery.data : undefined,
    mode: start.mode, edit, bill, start, f, set, setLine, addLine, removeLine, setCustomer, setFirm, setPaper, setPayment, setNumber, takeSuggestion,
    firm, firmName, firmState, firms, firmHint: hint, cust, auto, pos, tt, filled, figs, lineFig, newKeys,
    paper: f.paper && !edit, book, lastPaperDay, keep, moved, next, suggestion, numberText, stored, numberError, numberNote, numberState, waitingForNext,
    today, dateError, dateWarn, offReason, touched, setTouched, tried, errors, serverErrors, showErr, firstError,
    itax, cashOver, cashBlock, cashAnyway, setCashAnyway, twin, checks, canMove, whyNot, dirty, changes, sentNote,
    reviewOpen, openReview, closeReview, save, saving, saveError, savedTo, saveEnd, draftId, setDraftId,
  };
}

export type BillFormApi = ReturnType<typeof useBillForm>;

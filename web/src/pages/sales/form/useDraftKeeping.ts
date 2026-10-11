// A new bill keeps itself as an unfinished bill as it's typed (PROTO pages/sales/useBillForm.js:332-383): 1.2 s after the
// last change, once it has a customer, an item or a note, on this device at once and on the shop's list (contract §4).
// The address then names it (?draft=), so a reload, a session that ran out or a sign-in on this tab comes back to it.
// Leaving never asks (Ruling 1D-10): it says where to find the bill, and keeps at once a change the 1.2 s hadn't kept yet,
// also as the tab closes. Only a browser that refuses storage gets its own prompt as the tab closes, while a change isn't
// on the shop's list yet (Ruling 1D-11). Discard draft has Undo. Nothing is kept while the bill itself saves (a save that
// doesn't go through lets it be), nor ever again once a bill is made from it. Changing a saved bill keeps no draft.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { newDraftId, useDiscardDraft, useDraftBusy, useDraftSync, useKeepDraft, type KeepResult } from "@/core/api/drafts";
import { keepsOnDevice, keptDraft, useKeptDrafts } from "@/core/deviceDrafts";
import { timeOf } from "@/core/sales/words";
import { useToast } from "@/core/ui";
import { hasContent, toDraftData } from "./model";
import type { BillFormApi } from "./useBillForm";

export type DraftKeeping = {
  /** Something typed isn't in the draft yet (its 1.2 s haven't passed). Leaving keeps it at once; a save takes it with it. */
  pending: boolean;
  /** A write of the draft is on its way to the shop's list (this form's keep, or the sync's PUT of this device's change). */
  sending: boolean;
  /** The bill's save waits for that write to land before it goes, which can take up to a request's 100 s. */
  waiting: boolean;
  /**
   * Where it's kept: "server" (the shop's list), "device" (this device only, for now), "visit" (only until this page
   * closes: the browser refuses storage), or nowhere (null: not yet, or a bill was made from it already).
   */
  kept: "server" | "device" | "visit" | null;
  /** When it was last kept (an ISO time), and the server's words if it refused the draft or a bill was made from it. */
  at: string | null;
  refusal: string;
  discard: () => void;
  /** Where the form goes once the draft is discarded (Sales). */
  leaveTo: string | null;
};

/** Said where a browser refuses storage, instead of "on this device": the unfinished bill lasts only as long as the page. */
export const VISIT_ONLY = "This browser doesn't store unfinished bills, so this one lasts only while this page is open.";
/** Said while the bill's save waits for the draft's last change to land (the status line, and the review). */
export const SAVE_WAITS = "Saving once the draft's last change reaches the shop's list…";

export function draftText(d: DraftKeeping): string {
  if (d.waiting) return SAVE_WAITS;
  if (d.pending || d.sending) return "Keeping the draft…";
  if (d.refusal) return d.refusal;
  const when = d.at ? ` at ${timeOf(d.at)}` : "";
  if (d.kept === "server") return `Kept as a draft${when}`;
  if (d.kept === "device") return `Kept on this device${when}; it reaches the shop's list when the internet is back`;
  if (d.kept === "visit") return `Kept for this visit only${when}; it reaches the shop's list when the internet is back`;
  return "Kept as a draft once you start";
}

export function useDraftKeeping(F: BillFormApi, formKey: string): DraftKeeping {
  const navigate = useNavigate();
  const { show } = useToast();
  const keep = useKeepDraft();
  const discardDraft = useDiscardDraft();
  const isNew = !F.edit;
  useDraftSync(isNew);
  const data = toDraftData(F.f, F.start.replaces);
  const sig = JSON.stringify(data);
  const hasAny = Boolean(F.f.customer || F.f.lines.some(hasContent) || F.f.notes.trim());
  // what the draft holds now: a draft picked up holds what it started with; an untouched new bill (a copy, too) holds nothing yet
  const keptSig = useRef(JSON.stringify(toDraftData(F.start.form, F.start.replaces)));
  // where it's kept follows this device's copy: a sync that sends it later says so here too
  const mine = useKeptDrafts().find((d) => d.id === F.draftId && !d.gone);
  // a write of it on its way, whoever sent it: the save waits for exactly these (draftSettled)
  const busy = useDraftBusy(F.draftId);
  const [state, setState] = useState<{ at: string | null; refusal: string }>(() => ({ at: keptDraft(F.start.draftId ?? "")?.updated_at ?? null, refusal: "" }));
  const [pending, setPending] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  // a bill was made from it already (the server said so): there's no draft to keep any more
  const [billMade, setBillMade] = useState(false);
  /** Nothing more is kept: saved as a bill (here or on another counter), or discarded. */
  const done = useRef(false);
  const id = useRef(F.draftId);
  id.current = F.draftId;
  const latest = useRef({ data, business: F.f.firmId, hasAny });
  latest.current = { data, business: F.f.firmId, hasAny };
  const save = useRef({ saving: F.saving, savedTo: F.savedTo });
  save.current = { saving: F.saving, savedTo: F.savedTo };
  /** Something typed that no keep has taken yet. */
  const unkept = () => latest.current.hasAny && JSON.stringify(latest.current.data) !== keptSig.current;

  /** What a keep answered: when, the server's words if it refused, and no more keeping once a bill was made from it (Ruling 1D-8). */
  const heard = useCallback((r: KeepResult) => {
    if (r.kept === null) {
      done.current = true;
      setPending(false);
      setBillMade(true);
      setState({ at: null, refusal: r.refusal ?? "" });
      return;
    }
    setState({ at: new Date().toISOString(), refusal: r.refusal ?? "" });
  }, []);
  /**
   * Keeps the bill as it is now: on this device at once, then on the shop's list. The first keep names the draft in the
   * address, as the same form (formKey). Once the form has gone, it's only kept: nothing here is told how it went.
   */
  const keepNow = useCallback((here: boolean): string => {
    const fresh = !id.current;
    const draftId = id.current ?? newDraftId();
    const { data: d, business } = latest.current;
    keptSig.current = JSON.stringify(d);
    id.current = draftId;
    if (!here) { void keep(draftId, business, d); return draftId; }
    if (fresh) {
      F.setDraftId(draftId);
      navigate(`/sales/new?draft=${draftId}`, { replace: true, state: { formKey } });
    }
    void keep(draftId, business, d).then(heard);
    return draftId;
  }, [keep, navigate, formKey, heard, F.setDraftId]);

  // a save that says a bill was made from this draft already (409 draft_saved): nothing more is kept, and the status says
  // so in the server's words (the review shows them too, with a link to that bill)
  const madeAlready = F.saveError?.kind === "draft_saved" ? F.saveError.body : "";
  useEffect(() => { if (madeAlready) heard({ kept: null, refusal: madeAlready }); }, [madeAlready, heard]);
  // saved as a bill: the draft went with it (the server deleted it with the save)
  useEffect(() => { if (F.savedTo) done.current = true; }, [F.savedTo]);

  // nothing is kept while the bill itself is being saved, and nothing waits to be: the save takes the bill as it is, and
  // takes the draft off the shop's list (F18). A save that doesn't go through lets the change be kept as usual.
  useEffect(() => {
    if (!isNew || done.current || F.savedTo) return undefined;
    if (F.saving || sig === keptSig.current || !hasAny) { setPending(false); return undefined; }
    setPending(true);
    const t = setTimeout(() => {
      setPending(false);
      // kept meanwhile, as the page was hidden: not twice
      if (!done.current && unkept()) keepNow(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [sig, hasAny, F.savedTo, F.saving]); // eslint-disable-line react-hooks/exhaustive-deps

  // the tab closing or reloading, or a phone switching to another app, runs no React cleanup: a change the 1.2 s haven't
  // kept yet is kept then, on this device first (a localStorage write, which the page can still make as it goes). It's
  // named in the address too, as the page may come back from the browser's back-forward cache (Ruling 1D-10).
  useEffect(() => {
    const away = () => {
      // its own guards stay: the drafts layer refuses only a draft made a bill already, not a bill saved before it had one, nor a discarded draft
      if (!isNew || done.current || save.current.saving || save.current.savedTo || !unkept()) return;
      setPending(false);
      keepNow(true);
    };
    const hidden = () => { if (document.visibilityState === "hidden") away(); };
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", away); document.removeEventListener("visibilitychange", hidden); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving a new bill never asks (Ruling 1D-10): a change the 1.2 s hadn't kept yet is kept at once, on this device first,
  // and a toast says where to find the bill. That holds for every way out: a link, Back, and a move within /sales/new
  // (Alt N, another unfinished bill opened), which unmounts the form too. Left while the bill saves, nothing is kept while
  // that save is on its way (F6); what was typed is kept once it's known not to have gone through, and never once a bill
  // was made from the draft (a saved bill says so itself).
  const alive = useRef(true);
  const saveEnd = F.saveEnd;
  useEffect(() => {
    alive.current = true;
    /** failed: the form was left while the bill saved, and the save didn't go through: the toast says so first. */
    const left = (failed = false) => {
      const draftId = unkept() ? keepNow(false) : id.current;
      if (!draftId) return;
      const open = { label: "Open", onClick: () => navigate(`/sales/new?draft=${draftId}`) };
      show(failed
        ? { tone: "neg", title: "The bill didn't save", body: "What you typed is kept as an unfinished bill. Open it now?", action: open }
        : { tone: "brand", title: "Bill kept as a draft", body: "New bill lists it until it's finished. Open it now?", action: open });
    };
    return () => {
      alive.current = false;
      // StrictMode (in development) runs this cleanup and the effect again at once: only a form that stays gone has left
      queueMicrotask(() => {
        if (alive.current || !isNew || done.current || save.current.savedTo) return;
        // asked again once the save ends: a keep may have heard meanwhile that a bill was made from the draft
        if (save.current.saving) { void saveEnd.current?.then((how) => { if (how === "failed" && !done.current) left(true); }); return; }
        left();
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = useCallback(() => {
    const draftId = id.current;
    done.current = true;
    if (draftId) {
      const { data: d, business } = latest.current;
      void discardDraft(draftId);
      show({ title: "Draft discarded", body: "The unfinished bill is gone.", action: { label: "Undo", onClick: () => { void keep(draftId, business, d); } } });
    }
    setPending(false);
    setLeaveTo("/sales");
  }, [discardDraft, keep, show]);

  const visitOnly = !keepsOnDevice();
  const kept = billMade || !F.draftId ? null
    : mine ? (mine.synced ? "server" : visitOnly ? "visit" : "device")
    : F.start.draftId === F.draftId ? "server" : null;
  // where the browser refuses storage, a keep as the tab closes lives only in this page, and the unload may cancel its
  // PUT: a change not kept yet, or not on the shop's list yet (its keep on its way, or kept for this visit only), keeps
  // the browser's own prompt as the tab closes. Only that: leaving in the app keeps it at once, as the page lives on and
  // the PUT completes (Ruling 1D-11)
  const atRisk = isNew && visitOnly && (pending || kept === "visit");
  useEffect(() => {
    if (!atRisk) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [atRisk]);
  return {
    pending: isNew && pending && !leaveTo,
    sending: isNew && busy,
    waiting: isNew && F.saving && busy,
    kept, at: state.at ?? mine?.updated_at ?? null, refusal: state.refusal, discard, leaveTo,
  };
}

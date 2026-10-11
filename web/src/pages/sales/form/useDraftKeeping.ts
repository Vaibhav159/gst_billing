// A new bill keeps itself as an unfinished bill as it's typed (PROTO pages/sales/useBillForm.js:332-383): 1.2 s after the
// last change, once it has a customer, an item or a note, on this device at once and on the shop's list (contract §4).
// The address then names it (?draft=), so a reload, a session that ran out or a sign-in on this tab comes back to it.
// Leaving says where to find it, and keeps at once a change the 1.2 s hadn't kept yet; Discard draft has Undo. Nothing is
// kept while the bill itself saves, nor ever again once a bill is made from it. Changing a saved bill keeps no draft.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { newDraftId, useDiscardDraft, useDraftSync, useKeepDraft, type KeepResult } from "@/core/api/drafts";
import { keepsOnDevice, keptDraft, useKeptDrafts } from "@/core/deviceDrafts";
import { timeOf } from "@/core/sales/words";
import { useToast } from "@/core/ui";
import { hasContent, toDraftData } from "./model";
import type { BillFormApi } from "./useBillForm";

export type DraftKeeping = {
  /** Something typed isn't in the draft yet (its 1.2 s haven't passed). Never while the bill saves: the save takes it. */
  pending: boolean;
  /** A keep is on its way to the shop's list (it's on this device already). */
  sending: boolean;
  /** The bill's save waits for that keep to land before it goes, which can take up to a request's 100 s. */
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

export function draftText(d: DraftKeeping): string {
  if (d.waiting) return "Saving once the draft's last change reaches the shop's list…";
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
  useDraftSync();
  const isNew = !F.edit;
  const data = toDraftData(F.f, F.start.replaces);
  const sig = JSON.stringify(data);
  const hasAny = Boolean(F.f.customer || F.f.lines.some(hasContent) || F.f.notes.trim());
  // what the draft holds now: a draft picked up holds what it started with; an untouched new bill (a copy, too) holds nothing yet
  const keptSig = useRef(JSON.stringify(toDraftData(F.start.form, F.start.replaces)));
  // where it's kept follows this device's copy: a sync that sends it later says so here too
  const mine = useKeptDrafts().find((d) => d.id === F.draftId && !d.gone);
  const [state, setState] = useState<{ at: string | null; refusal: string }>(() => ({ at: keptDraft(F.start.draftId ?? "")?.updated_at ?? null, refusal: "" }));
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(0);
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
    setSending((n) => n + 1);
    void keep(draftId, business, d).then((r) => { setSending((n) => n - 1); heard(r); });
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
      if (done.current) return;
      setPending(false);
      keepNow(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [sig, hasAny, F.savedTo, F.saving]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving a new bill keeps it as a draft and says where to find it (a bill still saving says so itself when it's saved).
  // A change the 1.2 s hadn't kept yet is kept at once, on this device first: leaving by a link the guard asked about,
  // and moving within /sales/new (Alt N, another unfinished bill opened), which the guard doesn't ask about (F18).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // StrictMode (in development) runs this cleanup and the effect again at once: only a form that stays gone has left
      queueMicrotask(() => {
        if (alive.current || !isNew || done.current || save.current.saving || save.current.savedTo) return;
        const { data: d, hasAny: filled } = latest.current;
        const draftId = filled && JSON.stringify(d) !== keptSig.current ? keepNow(false) : id.current;
        if (!draftId) return;
        show({ tone: "brand", title: "Bill kept as a draft", body: "New bill lists it until it's finished. Open it now?", action: { label: "Open", onClick: () => navigate(`/sales/new?draft=${draftId}`) } });
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
  return {
    pending: isNew && pending && !leaveTo && !F.saving,
    sending: isNew && sending > 0,
    waiting: isNew && F.saving && sending > 0,
    kept, at: state.at ?? mine?.updated_at ?? null, refusal: state.refusal, discard, leaveTo,
  };
}

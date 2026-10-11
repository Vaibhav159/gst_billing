// What the form says about unfinished bills and the network (PROTO pages/sales/BillForm.jsx:180-253): finishing one
// someone started (with Discard draft), one that isn't there any more or that didn't open, the shop's other unfinished
// bills to open, and offline / back online. Drafts are shop-wide (the owner's answer, 10 Oct 2026): each says who started it.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Check, StickyNote, Trash2, Wifi, WifiOff } from "lucide-react";
import { useUnfinishedBills } from "@/core/api/drafts";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { keepsOnDevice } from "@/core/deviceDrafts";
import { possessive } from "@/core/format";
import { sentWhen, timeOf } from "@/core/sales/words";
import { Banner, Button, Spinner } from "@/core/ui";
import { useView } from "@/core/view";
import type { BillFormApi } from "./useBillForm";
import { draftText, VISIT_ONLY, type DraftKeeping } from "./useDraftKeeping";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function DraftBanners({ F, drafts, onTryReview }: { F: BillFormApi; drafts: DraftKeeping; onTryReview: () => void }) {
  const net = useNetwork();
  const navigate = useNavigate();
  const { isPhone } = useView();
  const { can } = useAuth();
  const list = useUnfinishedBills(can("bill.create") && !F.edit);
  const [all, setAll] = useState(false);
  // back online after being offline: offer to save now (nothing saves by itself)
  const wasDown = useRef(net === "offline");
  const [cameBack, setCameBack] = useState(false);
  useEffect(() => {
    if (net === "offline") { wasDown.current = true; setCameBack(false); }
    else if (net === "online" && wasDown.current) { wasDown.current = false; setCameBack(true); }
  }, [net]);
  const o = F.start.origin;
  const out = [];
  const who = F.cust ? (F.cust.type === "walkin" ? "the walk-in's" : possessive(F.cust.name)) : "this";
  if (net === "offline") {
    out.push(<Banner key="off" tone="muted" icon={WifiOff} title="You're offline: carry on with the bill" className="anim-rise">
      {F.edit ? "Your changes stay here. Save them when the internet is back."
        // a browser that refuses storage keeps it until the page closes, so it never says "on this device" (Task 1's review)
        : keepsOnDevice() ? "It's kept on this device as an unfinished bill. Save it when the internet is back; nothing saves by itself."
          : `${VISIT_ONLY} Save it when the internet is back; nothing saves by itself.`}
    </Banner>);
  } else if (cameBack && !F.edit) {
    out.push(<Banner key="back" tone="sale" icon={Wifi} title={`Back online · Save ${who} bill now`} className="anim-rise"
      actions={<><Button size="sm" variant="primary" onClick={() => { setCameBack(false); onTryReview(); }}>Check and save</Button><Button size="sm" variant="ghost" onClick={() => setCameBack(false)}>Later</Button></>}>
      Check its number against the paper bill, then save it. Nothing saves by itself.
    </Banner>);
  }
  if (o?.kind === "draft") {
    // a bill was made from it already (the server's words): it doesn't keep saving, and there's no draft to discard (Ruling 1D-8)
    const made = drafts.kept === null && drafts.refusal ? drafts.refusal : "";
    out.push(<Banner key="d" tone="muted" title="Finishing an unfinished bill" actions={made ? null : <Button size="sm" variant="danger-outline" icon={Trash2} onClick={drafts.discard}>Discard draft</Button>}>
      Started {sentWhen({ at: o.startedAt })} by {o.startedBy?.name ?? "someone"}. {made || "It keeps saving as you go."}
    </Banner>);
  }
  if (o?.kind === "missing-draft") out.push(<Banner key="m" tone="neg" title="That unfinished bill isn't here any more">It was saved as a bill or discarded. This is a new, empty bill.</Banner>);
  // neither this device nor the shop's list could give it: the list didn't load, so it may well still be there (Ruling 1D-4).
  // Offline, the internet is what to wait for; online, the list failed (a 500, a refusal), so it's the list
  if (o?.kind === "unread-draft") {
    out.push(<Banner key="u" tone="neg" title="That unfinished bill didn't open">
      This device has no copy of it, and the shop&apos;s list didn&apos;t load. This is a new, empty bill; open that one again {net === "offline" ? "when the internet is back" : "once the list loads"}.
    </Banner>);
  }
  if (!F.edit && o?.kind !== "draft") {
    // a change the shop hasn't got yet: on this device, or, where the browser refuses storage, only in this page
    const unsent = keepsOnDevice() ? " · on this device" : " · not sent yet";
    const others = list.bills.filter((d) => d.id !== F.draftId);
    const shown = all ? others : others.slice(0, 3);
    if (shown.length) {
      out.push(
        <ul key="o" aria-label="Unfinished bills" className="flex flex-col gap-1 -mt-1">
          {shown.map((d) => {
            const c = d.data.customer;
            const firm = F.firms.length > 1 ? F.firms.find((x) => x.id === d.business)?.short : "";
            return (
              <li key={d.id} className="text-sm text-fg2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <StickyNote size={15} className="text-muted shrink-0" aria-hidden="true" />
                <span>{c ? possessive(c.name) : "An"} unfinished bill{firm ? ` in ${firm}` : ""} · {isPhone ? timeOf(d.created_at) : `started ${sentWhen({ at: d.created_at }).replace(/^at /, "")} by ${d.started_by ? firstName(d.started_by.name) : "someone"}`}{d.onDevice ? unsent : ""}</span>
                <Button size="sm" variant="link" className="min-w-[44px]" aria-label={`Open ${c ? possessive(c.name) : "the"} unfinished bill`} onClick={() => navigate(`/sales/new?draft=${d.id}`, { replace: true })}>Open</Button>
              </li>
            );
          })}
          {others.length > shown.length ? <li><Button size="sm" variant="link" onClick={() => setAll(true)}>{`Show all ${others.length} unfinished bills`}</Button></li> : null}
        </ul>,
      );
    }
  }
  return <>{out}</>;
}

/** Where the bill stands: kept as a draft (a new bill), or changed and not saved (a change to a saved bill). */
export function DraftStatus({ F, drafts, className }: { F: BillFormApi; drafts: DraftKeeping; className?: string }) {
  const text = F.edit ? (F.dirty ? "Changes not saved yet" : "No changes yet") : draftText(drafts);
  const busy = !F.edit && (drafts.pending || drafts.sending || drafts.waiting);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-live="polite">
      {busy ? <Spinner size={14} /> : !F.edit && drafts.kept && !drafts.refusal ? <Check size={14} className="text-sale" aria-hidden="true" /> : null}
      {text}
    </span>
  );
}

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { ArrowRightLeft, Ban, Copy, ExternalLink, Hash, History, Link2, Pencil, Printer, RefreshCcw, Send, Share2, Trash2, Truck, UserRound } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import type { Action } from "@/core/auth/permissions";
import { todayIST } from "@/core/format";
import { LOCKED_REASON, sentWhen } from "@/core/sales/words";
import type { MenuItem } from "@/core/ui";
import type { DialogBill, OpenDialog } from "./BillDialogs";
import { useCopyBillLink, useShareBill } from "./deliver";
import { useSendBill, useSendReady } from "./useSendBill";

/** Which items a screen lists; the rest are buttons on that screen already. */
export type MenuShow = { open?: boolean; print?: boolean; sendIt?: boolean; shareIt?: boolean; duplicate?: boolean; edit?: boolean; eway?: boolean; link?: boolean; renumber?: boolean; move?: boolean; links?: boolean; remake?: boolean };

/**
 * A bill's actions, for a list row, the preview and the bill page (PROTO sales/parts.jsx:355-401). Each item someone
 * can't use is greyed with the reason as its hint: who may (design §6: only the owner edits, renumbers, moves, cancels,
 * deletes or records an e-way bill), a filed month, or a cancelled bill.
 */
export function useBillMenu(): (b: DialogBill, open: OpenDialog, show?: MenuShow) => MenuItem[] {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const send = useSendBill();
  // Send stays off until the shop's settings answer, as the list's Send does, so the shop's own message goes with it
  const ready = useSendReady();
  const share = useShareBill();
  const copyLink = useCopyBillLink();
  return useCallback((b, openDialog, show = {}) => {
    const { open = true, print = true, sendIt = true, shareIt = false, duplicate = true, edit = true, eway = false, link = false, renumber = false, move = false, links = false, remake = true } = show;
    const cancelled = b.status === "cancelled";
    const lockHint = b.locked ? LOCKED_REASON : "";
    const why = (perm: Action, blocked = "", fine?: string): string | undefined => (!can(perm) ? whyNot(perm) : blocked || fine);
    const items: MenuItem[] = [];
    if (open) items.push({ label: "Open", icon: ExternalLink, onSelect: () => navigate(`/sales/${b.id}`) });
    if (print) items.push({ label: "Print or PDF", icon: Printer, onSelect: () => navigate(`/sales/${b.id}/print`) });
    if (sendIt && !cancelled) {
      items.push({
        label: b.sent ? "Send again on WhatsApp" : b.paper ? "Send a copy on WhatsApp" : "Send on WhatsApp", icon: Send, disabled: !can("bill.send") || !ready,
        hint: !can("bill.send") ? whyNot("bill.send") : !ready ? "Getting the shop's WhatsApp message" : b.sent ? `Sent ${sentWhen(b.sent, todayIST())}` : b.paper ? "The customer has the paper bill" : undefined,
        onSelect: () => { void send(b, { onNeedNumber: () => openDialog("whatsapp", b) }); },
      });
    }
    if (shareIt) items.push({ label: "Share the PDF…", icon: Share2, hint: "Email, Drive or a printer app", onSelect: () => share(b) });
    if (link) items.push({ label: "Copy link", icon: Link2, hint: "For anyone signed in to the app", onSelect: () => copyLink(b) });
    const replaced = "replaced_by" in b && Boolean(b.replaced_by);
    if (cancelled && remake && !replaced) {
      items.push({ label: "Make it again", icon: RefreshCcw, disabled: !can("bill.create"), hint: why("bill.create", "", "A new bill with the same customer, items and payment"), onSelect: () => navigate(`/sales/new?remake=${b.id}`) });
    } else if (duplicate && !cancelled) {
      items.push({ label: "Duplicate", icon: Copy, disabled: !can("bill.create"), hint: why("bill.create", "", "A new bill with the same customer and items"), onSelect: () => navigate(`/sales/new?from=${b.id}`) });
    }
    if (edit) {
      items.push({ label: "Edit", icon: Pencil, disabled: !can("bill.edit") || b.locked || cancelled, hint: why("bill.edit", lockHint || (cancelled ? "Cancelled bills can't be changed" : "")), onSelect: () => navigate(`/sales/${b.id}/edit`) });
    }
    if (eway) {
      // a filed month's bill keeps its e-way details too: the server refuses the change (contract §2.8, month_closed)
      const has = "eway" in b && Boolean(b.eway.eway_bill_number);
      items.push({ label: has ? "Edit the e-way bill…" : "E-way bill…", icon: Truck, disabled: !can("bill.edit") || b.locked || cancelled,
        hint: why("bill.edit", lockHint || (cancelled ? "Cancelled bills don't travel" : ""), "Number, transporter, vehicle, distance"), onSelect: () => openDialog("eway", b) });
    }
    if (renumber) {
      items.push({ label: "Renumber…", icon: Hash, disabled: !can("bill.edit") || b.locked || cancelled,
        hint: why("bill.edit", lockHint || (cancelled ? "Cancelled bills keep their number" : ""), "Give it another number in this firm's series"), onSelect: () => openDialog("renumber", b) });
    }
    if (move) {
      items.push({ label: "Move to another firm…", icon: ArrowRightLeft, disabled: !can("bill.edit") || b.locked || cancelled,
        hint: why("bill.edit", lockHint || (cancelled ? "Cancelled bills stay in their firm" : ""), "It takes a number in the other firm's series"), onSelect: () => openDialog("move", b) });
    }
    if (items.length) items.push({ divider: true });
    items.push({ label: "Cancel bill…", icon: Ban, tone: "danger", disabled: !can("bill.cancel") || b.locked || cancelled,
      hint: why("bill.cancel", lockHint || (cancelled ? "Already cancelled" : ""), "Keeps its number; GSTR-1 shows it as cancelled"), onSelect: () => openDialog("cancel", b) });
    items.push({ label: "Delete…", icon: Trash2, tone: "danger", disabled: !can("bill.delete") || b.locked,
      hint: why("bill.delete", lockHint, "Moves it to the Audit log, where it can be restored"), onSelect: () => openDialog("delete", b) });
    if (links) {
      const extra: MenuItem[] = [];
      if (b.customer.type !== "walkin") extra.push({ label: "Customer's page", icon: UserRound, onSelect: () => navigate(`/customers/${b.customer.id}`) });
      extra.push({ label: "Audit log", icon: History, hint: "Every change to every bill", onSelect: () => navigate("/audit") });
      items.push({ divider: true }, ...extra);
    }
    return items;
  }, [can, whyNot, navigate, send, ready, share, copyLink]);
}

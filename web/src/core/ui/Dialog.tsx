import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { Button, IconButton } from "./Button";
import { Portal, useDragClose, useFocusTrap, useGhostGuard, usePresence } from "./Overlay";

/** Last value seen while open, so content doesn't blank out during the exit animation. */
function useHeld<T>(open: boolean, value: T): T {
  const held = useRef(value);
  if (open) held.current = value;
  return open ? value : held.current;
}

export type DialogSize = "sm" | "md" | "lg" | "xl";
export type DialogProps = {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; footer?: ReactNode; size?: DialogSize;
  initialFocus?: RefObject<HTMLElement>;
  /** What typing would be lost ("Discard this item?"); closing then asks first. */
  confirmClose?: boolean | string;
  children: ReactNode;
};

/** Modal dialog. On phones it rises from the bottom; Esc and the scrim close it; it animates out. */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", initialFocus, confirmClose }: DialogProps) {
  const { isPhone, isEasy } = useView();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const { mounted, closing } = usePresence(open, isPhone ? 220 : 170);
  // confirmClose: what typing would be lost ("Discard this item?"); closing then asks first
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!open) setAsking(false); }, [open]);
  const tryClose = confirmClose ? () => setAsking(true) : onClose;
  useFocusTrap(ref, open, tryClose, initialFocus);
  const guard = useGhostGuard(open);
  const drag = useDragClose(tryClose, isPhone && open);
  const heldChildren = useHeld(open, children);
  const heldFooter = useHeld(open, footer);
  const heldTitle = useHeld(open, title);
  const heldDesc = useHeld(open, description);
  if (!mounted) return null;
  children = heldChildren; footer = heldFooter; title = heldTitle; description = heldDesc;
  const w = { sm: "max-w-[440px]", md: "max-w-[580px]", lg: "max-w-[780px]", xl: "max-w-[1000px]" }[size];
  return (
    <Portal>
      <div onClickCapture={guard} className={cn("absolute inset-0 z-sheet flex", closing ? "pointer-events-none" : "pointer-events-auto", isPhone ? "items-end" : "items-center justify-center p-6")}>
        <div className={cn("absolute inset-0 bg-scrim/60", closing ? "anim-fade-out" : "anim-fade")} onClick={tryClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id + "t"} aria-describedby={description ? id + "d" : undefined} tabIndex={-1} data-closing={closing ? "" : undefined}
          style={isPhone ? { transform: drag.dy ? `translateY(${drag.dy}px)` : undefined, transition: drag.dy ? "none" : undefined, maxHeight: "calc(94% - var(--kb, 0px))", marginBottom: "var(--kb, 0px)" } : undefined}
          className={cn("relative flex flex-col bg-card border border-line shadow-pop min-h-0 outline-none", isPhone ? cn("w-full rounded-t-xl", closing ? "anim-sheet-out" : "anim-sheet") : cn("w-full rounded-xl max-h-full", closing ? "anim-pop-out" : "anim-pop", w))}>
          {isPhone ? <div {...drag.handlers} className="pt-2 pb-1 flex justify-center touch-none cursor-grab" aria-hidden="true"><span className="w-10 h-1 rounded-full bg-ctl-line" /></div> : null}
          <div {...(isPhone ? drag.handlers : {})} className={cn("flex items-start gap-3 px-5 pt-4 pb-2", isPhone && "touch-none")}>
            <div className="flex-1 min-w-0">
              <h2 id={id + "t"} tabIndex={-1} data-dialog-title="" className="text-lg font-semibold leading-snug outline-none">{title}</h2>
              {description ? <p id={id + "d"} className={cn("text-muted mt-1", isEasy ? "text-[15px] leading-[21px]" : "text-sm")}>{description}</p> : null}
            </div>
            <IconButton label="Close" icon={X} onClick={tryClose} size="sm" className="-mr-2 -mt-1" />
          </div>
          {asking ? (
            <div role="alert" className="mx-5 mb-2 rounded-ctl border border-neg-line bg-neg-tint px-3 py-2 flex flex-wrap items-center gap-2 anim-rise">
              <span className="flex-1 min-w-[10rem] font-medium">{confirmClose}</span>
              <Button size="sm" onClick={() => setAsking(false)} autoFocus>Keep editing</Button>
              <Button size="sm" variant="danger" onClick={() => { setAsking(false); onClose(); }}>Discard</Button>
            </div>
          ) : null}
          <div className="px-5 py-3 overflow-y-auto min-h-0 flex-1">{children}</div>
          {footer ? <div className={cn("px-5 pt-4 border-t border-rule flex gap-2", isPhone ? "flex-col-reverse [&>*]:w-full pb-[calc(16px+env(safe-area-inset-bottom,0px))]" : "pb-4 justify-end")}>{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

export type SheetProps = { open: boolean; onClose: () => void; title: string; description?: ReactNode; footer?: ReactNode; width?: number; children: ReactNode };

/** Side panel on desktop, bottom sheet on phones. */
export function Sheet({ open, onClose, title, description, children, footer, width = 460 }: SheetProps) {
  const { isPhone } = useView();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const { mounted, closing } = usePresence(open, 190);
  useFocusTrap(ref, open && !isPhone, onClose);
  const guard = useGhostGuard(open);
  const held = { children: useHeld(open, children), footer: useHeld(open, footer), title: useHeld(open, title), description: useHeld(open, description) };
  if (isPhone) return <Dialog open={open} onClose={onClose} title={title} description={description} footer={footer}>{children}</Dialog>;
  if (!mounted) return null;
  ({ children, footer, title, description } = held);
  return (
    <Portal>
      <div onClickCapture={guard} className={cn("absolute inset-0 z-sheet flex justify-end", closing ? "pointer-events-none" : "pointer-events-auto")}>
        <div className={cn("absolute inset-0 bg-scrim/50", closing ? "anim-fade-out" : "anim-fade")} onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id + "t"} tabIndex={-1} style={{ width }}
          className={cn("relative h-full max-w-full flex flex-col bg-card border-l border-line shadow-pop outline-none", closing ? "anim-side-out" : "anim-side")}>
          <div className="flex items-start gap-3 px-6 pt-5 pb-3 border-b border-rule">
            <div className="flex-1 min-w-0">
              <h2 id={id + "t"} className="text-lg font-semibold">{title}</h2>
              {description ? <p className="text-sm text-muted mt-1">{description}</p> : null}
            </div>
            <IconButton label="Close" icon={X} onClick={onClose} size="sm" className="-mr-2" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">{children}</div>
          {footer ? <div className="px-6 py-4 border-t border-rule flex justify-end gap-2">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

export type ConfirmDialogProps = {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string;
  /** What's being confirmed, shown in a box; usually <DL rows={[[label, value], …]} />. */
  record?: ReactNode;
  confirmLabel?: string; cancelLabel?: string; tone?: "primary" | "danger";
  /** A sentence the person must tick before confirming. */
  ack?: string;
  confirmDisabled?: boolean; extra?: ReactNode; busy?: boolean; busyLabel?: string; children?: ReactNode;
};

/**
 * Confirmation that names the record (record: the rows, in a box).
 * ack: optional sentence the person must tick before confirming.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, record, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary", ack, confirmDisabled, extra, busy, busyLabel }: ConfirmDialogProps) {
  const [acked, setAcked] = useState(false);
  useEffect(() => { if (!open) setAcked(false); }, [open]);
  // while it saves, the dialog stays: Esc, the scrim and Cancel do nothing until the answer comes back
  const close = busy ? () => {} : onClose;
  return (
    <Dialog open={open} onClose={close} title={title} size="sm"
      footer={<><Button onClick={close} disabled={busy}>{cancelLabel}</Button><Button variant={tone === "danger" ? "danger" : "primary"} disabled={Boolean(ack && !acked) || confirmDisabled} loading={busy} onClick={onConfirm}>{busy ? busyLabel || "Saving…" : confirmLabel}</Button></>}>
      <div className="flex flex-col gap-3">
        {record ? <div className="rounded-ctl border border-line bg-field px-4 py-1">{record}</div> : null}
        {children ? <div className="text-fg2 flex flex-col gap-2">{children}</div> : null}
        {extra}
        {ack ? <Checkbox label={ack} checked={acked} onChange={setAcked} /> : null}
      </div>
    </Dialog>
  );
}

/**
 * The prototype's Checkbox (core/ui.jsx 542–557), the part ConfirmDialog uses. It's private
 * because Task 8 ports the kit's Checkbox (Choice.tsx) alongside this; once both are in, import that one.
 */
function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const iid = useId();
  const { isPhone } = useView();
  return (
    <label htmlFor={iid} className={cn("inline-flex items-start gap-2.5 cursor-pointer select-none", isPhone && "min-h-11 items-center")}>
      <input id={iid} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-brand cursor-pointer" />
      <span>
        <span>{label}</span>
      </span>
    </label>
  );
}

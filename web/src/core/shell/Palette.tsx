// Search's frame opens synchronously; only its records load on demand (Ruling 1E-20).
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Dialog, FailNote, Kbd } from "@/core/ui";
import { useView } from "@/core/view";
import type { PaletteRecordsHandle } from "./PaletteRecords";
import type { DueItem } from "@/core/api/dashboard";

export const paletteCode = { load: () => import("./PaletteRecords") };
const PaletteRecords = lazy(paletteCode.load);

class RecordsBoundary extends Component<{ children: ReactNode; hasText: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <>
      <FailNote error={{ title: "Search couldn't load", body: `Reload the page to search again.${this.props.hasText ? " What you typed is still in the box." : ""}` }} />
      <ul id="palette-list" role="listbox" aria-label="Results" className="hidden" />
    </>;
  }
}

export function Palette({ open, onClose, attention }: { open: boolean; onClose(): void; attention?: DueItem[] }) {
  const { isPhone } = useView();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const records = useRef<PaletteRecordsHandle>(null);
  // Clear as Search closes, so keys typed immediately after the next open never join the previous search.
  useEffect(() => { if (!open) { setQ(""); setI(0); } }, [open]);
  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} title="Search" size="md" initialFocus={input}
      footer={isPhone ? null : <p className="text-xs text-muted flex items-center gap-3 w-full"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span className="ml-auto">Try “udhaar sep”, “kiran gstr1” or “new anil”</span></p>}>
      <div className="flex flex-col gap-3 -mt-1">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-label="Search customers, bills and pages"
            value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={(e) => records.current?.onKey(e)}
            placeholder="Customer, phone, bill number, a page, or “udhaar sep”" className="ctl pl-11" />
        </div>
        <RecordsBoundary hasText={Boolean(q)}>
          <Suspense fallback={<><p role="status" className="px-3 py-6 text-center text-muted">Loading search…</p><ul id="palette-list" role="listbox" aria-label="Results" className="hidden" /></>}>
            <PaletteRecords ref={records} open={open} q={q} i={i} setI={setI} input={input} onClose={onClose} attention={attention} />
          </Suspense>
        </RecordsBoundary>
      </div>
    </Dialog>
  );
}

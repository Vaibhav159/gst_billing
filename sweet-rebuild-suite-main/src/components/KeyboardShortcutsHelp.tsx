import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { category: "Navigation", items: [
    { key: "D", desc: "Go to Dashboard" },
    { key: "C", desc: "Go to Customers" },
    { key: "I", desc: "Go to Invoices" },
    { key: "P", desc: "Go to Products" },
    { key: "B", desc: "Go to Businesses" },
    { key: "R", desc: "Go to Reports" },
    { key: "G", desc: "Go to GST Summary" },
    { key: "N", desc: "New Invoice" },
  ]},
  { category: "Actions", items: [
    { key: "⌘K", desc: "Open Command Palette" },
    { key: "/", desc: "Focus Search" },
    { key: "⌘S", desc: "Submit Form" },
    { key: "Esc", desc: "Close Modal / Dismiss" },
    { key: "?", desc: "Show Shortcuts" },
  ]},
];

export default function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Keyboard className="w-5 h-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {shortcuts.map((group) => (
            <div key={group.category}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group.category}</p>
              <div className="space-y-1.5">
                {group.items.map((s) => (
                  <div key={s.key} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-secondary/30 transition-colors">
                    <span className="text-[13px] text-foreground">{s.desc}</span>
                    <kbd className="text-[11px] font-mono bg-secondary/60 text-muted-foreground px-2 py-0.5 rounded-md border border-border/40">{s.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

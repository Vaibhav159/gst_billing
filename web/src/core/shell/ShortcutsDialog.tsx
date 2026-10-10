import { cn } from "@/core/cn";
import { Dialog, Kbd } from "@/core/ui";
import { ALT, MOD } from "./nav";

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string[], string][] = [
    [[MOD, "K"], "Search customers, bills and pages"],
    [[ALT, "N"], "New sales bill"],
    [[ALT, "P"], "New purchase"],
    [["/"], "Search this list"],
    [["↑", "↓"], "Move through a list; Enter opens"],
    [[MOD, "Enter"], "Add a line while making a bill"],
    [[MOD, "S"], "Check and save the bill"],
    [[MOD, "Z"], "Undo the last delete, discard or removed line (30 seconds)"],
    [["?"], "Show these shortcuts"],
    [["Esc"], "Close a dialog or menu"],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" description={`Shortcuts never fire while you type in a field, except ${MOD} K and ${MOD} S.`} size="sm">
      <ul className="flex flex-col">
        {rows.map(([k, d], i) => (
          <li key={i} className={cn("flex items-center justify-between gap-4 py-2.5", i && "border-t border-rule")}>
            <span className="text-fg2">{d}</span>
            <span className="flex gap-1">{k.map((x) => <Kbd key={x}>{x}</Kbd>)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

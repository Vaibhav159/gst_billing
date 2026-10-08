import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/utils/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleIcon?: ReactNode;
  /** Beside the X, e.g. "Clear All". */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The phone's bottom sheet, in the look the hand-rolled ones had (UX3).
 *
 * Those were framer-motion divs in an AnimatePresence around an unkeyed
 * Fragment: after a More item changed the route, the drawer stayed over most
 * of the screen, its X and backdrop did nothing, and taps meant for the
 * bottom nav landed on its items. This is a Radix dialog (shadcn's Sheet):
 * a dialog role, focus kept inside, Escape and the backdrop close it, and it
 * leaves the page when closed. A route change closes it too.
 */
export default function BottomSheet({ open, onOpenChange, title, titleIcon, actions, children }: Props) {
  const { pathname } = useLocation();
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    if (open) onOpenChange(false);
    // Only a change of route closes it here, not a change of open or the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideClose
        aria-describedby={undefined}
        overlayClassName="z-[60] bg-black/50 backdrop-blur-sm"
        className="z-[61] p-0 border-0 bg-transparent shadow-none"
      >
        <div className="elevated-card rounded-t-2xl max-h-[70vh] overflow-y-auto safe-area-bottom">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              {titleIcon}
              <SheetTitle className="text-base font-display font-semibold text-foreground">{title}</SheetTitle>
            </div>
            <div className="flex items-center gap-3">
              {actions}
              <SheetClose aria-label="Close" className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40">
                <X className="w-5 h-5" />
              </SheetClose>
            </div>
          </div>

          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A drawer row that goes somewhere, highlighted while you are there. */
export function SheetLink({ to, match = to, icon: Icon, label, onNavigate }: {
  to: string;
  match?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(match);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all",
        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary/30"
      )}
    >
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", active ? "bg-primary/15" : "bg-secondary/40")}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <span className="text-[14px] font-medium">{label}</span>
    </Link>
  );
}

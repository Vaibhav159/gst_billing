import { Building2, ChevronDown } from "lucide-react";
import { cn } from "@/core/cn";
import { useFirms, useScope, type Firm, type Scope } from "@/core/scope";
import { Menu, useToast, type MenuItem, type ToastApi } from "@/core/ui";

/** "Kiran, Meera and Aarav together": what All firms adds up. */
function together(firms: Firm[]): string | undefined {
  const names = firms.map((f) => f.short);
  if (names.length < 2) return undefined;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} together`;
}

/** Which firm lists and figures follow: every firm by its short name, the GSTIN beside it. */
export function FirmPicker() {
  const { firmId, setFirmId } = useScope();
  const { firms, error } = useFirms();
  const firm = typeof firmId === "number" ? firms.find((f) => f.id === firmId) : undefined;
  // until this person's firm is known and, for one firm, the list has its name: loading, or that the list couldn't load
  const failed = typeof firmId === "number" && !firm && error;
  const label = firmId === "all" ? "All firms" : firm ? firm.short : null;
  return (
    <Menu width={280} title="Firm"
      items={[{ heading: "Lists and figures follow" }, { label: "All firms", checked: firmId === "all", hint: together(firms), onSelect: () => setFirmId("all") }, ...firms.map((f) => ({ label: f.short, checked: firmId === f.id, hint: f.gstin, onSelect: () => setFirmId(f.id) }))]}
      trigger={(p) => (
        <button {...p} type="button" aria-label={`Firm: ${label ?? (failed ? "couldn't load" : "loading")}`} className="h-10 inline-flex items-center gap-2 px-3 rounded-ctl border border-line bg-card hover:border-muted/50 transition-colors max-w-[200px]">
          <Building2 size={16} className="text-brand shrink-0" aria-hidden="true" /><span className="truncate">{label ?? (failed ? "Couldn't load" : "…")}</span><ChevronDown size={14} className="text-muted shrink-0" aria-hidden="true" />
        </button>
      )} />
  );
}

/** The financial years a person can pick: lists and figures follow the pick. */
export function fyItems({ fy, setFy, fyChoices }: Pick<Scope, "fy" | "setFy" | "fyChoices">, toast: ToastApi["show"]): MenuItem[] {
  const current = fyChoices[0];
  return [{ heading: "Lists and figures follow" }, ...fyChoices.map((y): MenuItem => {
    const start = Number(y.slice(0, 4));
    return {
      label: `FY ${y}${y === current ? " · this year" : ""}`, checked: y === fy,
      hint: `1 Apr ${start} to 31 Mar ${start + 1}`,
      onSelect: () => { setFy(y); if (y !== current) toast({ tone: "brand", title: `Showing FY ${y}`, body: "Lists, figures and returns follow the year you pick. Today's bills stay on the dashboard." }); },
    };
  })];
}

export function FyPicker() {
  const scope = useScope();
  const { show } = useToast();
  const past = scope.fy !== scope.fyChoices[0];
  return (
    <Menu width={290} title="Financial year" items={fyItems(scope, show)}
      trigger={(p) => (
        <button {...p} type="button" aria-label={`Financial year ${scope.fy}${past ? ", not the current year" : ""}`} className={cn("h-10 inline-flex items-center gap-1.5 px-3 rounded-ctl border bg-card transition-colors", past ? "border-brand text-brand" : "border-line hover:border-muted/50")}>
          <span className="text-brand font-semibold">FY</span> {scope.fy} <ChevronDown size={14} className="text-muted" aria-hidden="true" />
        </button>
      )} />
  );
}

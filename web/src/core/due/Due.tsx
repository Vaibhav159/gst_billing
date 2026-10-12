import { date, daysBetween } from "@/core/format";
import { chipWhen } from "./model";
/** Returns' long due line keeps the prototype's 7-day amber threshold. Due-item chips use 15. */
export function Due({ today, iso, label }: { today: string; iso: string; label: string }) {
  const n = daysBetween(today, iso), words = n > 1 ? `in ${n} days` : chipWhen(today, iso);
  return <span>{label} due {date(iso)} · <span className={n <= 3 ? "text-neg font-semibold" : n <= 7 ? "text-amber font-semibold" : ""}>{words}</span></span>;
}

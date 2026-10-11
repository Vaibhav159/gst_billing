import { CircleCheck, CircleDot, FileCheck2, Lock, LockOpen, TriangleAlert, type LucideIcon } from "lucide-react";
import { addMonths, daysBetween, plural } from "@/core/format";
import type { Due, Stage } from "./types";

export const TONE_TEXT = { sale: "text-sale", brand: "text-brand", amber: "text-amber", neg: "text-neg", file: "text-file", muted: "text-muted" } as const;
export type GstTone = keyof typeof TONE_TEXT;
export type StageMeta = { label: string; short: string; word: string; tone: GstTone; icon: LucideIcon | null };

export const STATE_META: Record<Stage, StageMeta> = {
  filed: { label: "Filed and locked", short: "Filed · locked", word: "Filed", tone: "file", icon: Lock },
  gstr1: { label: "GSTR-1 filed · GSTR-3B to file", short: "GSTR-1 filed", word: "GSTR-1 filed", tone: "file", icon: FileCheck2 },
  blocked: { label: "Blocked", short: "Blocked", word: "Blocked", tone: "neg", icon: TriangleAlert },
  ready: { label: "Ready to file", short: "Ready to file", word: "Ready", tone: "sale", icon: CircleCheck },
  open: { label: "Open · month running", short: "Open", word: "Open", tone: "muted", icon: CircleDot },
  unlocked: { label: "Unlocked for a correction", short: "Unlocked", word: "Unlocked", tone: "muted", icon: LockOpen },
  future: { label: "Not started", short: "–", word: "–", tone: "muted", icon: null },
};

/** Display fallback only; each GST response supplies the authoritative Due. */
export function dueDates(month: string): Due {
  const next = addMonths(month, 1);
  return { gstr1: `${next}-11`, gstr3b: `${next}-20`, file_from: `${next}-01` };
}

/** Pass the server's IST today so every month on the screen agrees. */
export function dueText(today: string, due: string): string {
  const days = daysBetween(today, due);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  return `${plural(-days, "day")} late`;
}

export function dueTone(days: number): GstTone {
  return days <= 3 ? "neg" : days <= 15 ? "brand" : "muted";
}

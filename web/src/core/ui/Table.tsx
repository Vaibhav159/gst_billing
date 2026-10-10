import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/core/cn";

/* ── Tables ────────────────────────────────────────────── */
export type CellAlign = "left" | "right" | "center";
export type TableProps = { label: string; minWidth?: number; className?: string; children: ReactNode };
export type ThProps = { align?: CellAlign } & Omit<ThHTMLAttributes<HTMLTableCellElement>, "align">;
export type TdProps = { align?: CellAlign } & Omit<TdHTMLAttributes<HTMLTableCellElement>, "align">;
export type TrProps = { selected?: boolean } & HTMLAttributes<HTMLTableRowElement>;

/** `label` names the table for screen readers. It scrolls sideways when it can't fit. */
export function Table({ children, label, className, minWidth }: TableProps) {
  return (
    <div className="scroll-x">
      <table aria-label={label} className={cn("w-full border-collapse text-left", className)} style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}
export function Th({ children, align, className, ...rest }: ThProps) {
  return <th scope="col" className={cn("caps py-2.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap border-b border-rule", align === "right" && "text-right", align === "center" && "text-center", className)} {...rest}>{children}</th>;
}
export function Td({ children, align, className, ...rest }: TdProps) {
  return <td className={cn("py-3 px-3 first:pl-5 last:pr-5 align-middle", align === "right" && "text-right tnum whitespace-nowrap", align === "center" && "text-center", className)} {...rest}>{children}</td>;
}
export function Tr({ onClick, selected, children, className, ...rest }: TrProps) {
  return <tr onClick={onClick} className={cn("border-t border-rule first:border-t-0 transition-colors duration-100", onClick && "cursor-pointer hover:bg-raised/50", selected && "bg-brand-sel/50", className)} {...rest}>{children}</tr>;
}

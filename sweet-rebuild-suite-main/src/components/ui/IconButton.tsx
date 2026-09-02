import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/utils";

/**
 * An icon-only control with a real hit area and a real name (audit E5).
 *
 * The phone-first list rows used 26x26 buttons with no accessible name:
 * below Apple's and Google's 44px minimum, and silent to a screen reader.
 * The icon stays small; the padding makes the target.
 */
type Common = { label: string; className?: string; children: React.ReactNode };
type AsLink = Common & { to: string; onClick?: never; disabled?: never };
type AsButton = Common & { to?: undefined; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean };

const base = "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-40";

export default function IconButton(props: AsLink | AsButton) {
  const { label, className, children } = props;
  if (props.to) {
    return <Link to={props.to} aria-label={label} title={label} className={cn(base, className)}>{children}</Link>;
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} aria-label={label} title={label} className={cn(base, className)}>
      {children}
    </button>
  );
}

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { Link } from "react-router";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

/* ── Buttons ───────────────────────────────────────────── */
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "danger-outline" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const BTN: Record<ButtonVariant, string> = {
  primary: "bg-brand text-onbrand hover:bg-brand-hover font-semibold",
  secondary: "bg-raised text-fg border border-line hover:border-muted/50",
  outline: "border border-brand-line text-brand hover:bg-brand-tint font-semibold",
  ghost: "text-fg2 hover:text-fg hover:bg-raised",
  danger: "bg-danger text-white font-semibold hover:brightness-110",
  "danger-outline": "border border-neg-line text-neg hover:bg-neg-tint",
  link: "text-brand font-semibold hover:underline underline-offset-4",
};
function btnSize(size: ButtonSize, isPhone: boolean, variant: ButtonVariant): string {
  if (variant === "link") return cn("gap-1.5", isPhone ? "min-h-11" : "min-h-8");
  return {
    sm: isPhone ? "min-h-11 px-3 text-sm gap-1.5 rounded-ctl" : "h-8 px-3 text-sm gap-1.5 rounded-md",
    md: isPhone ? "min-h-11 px-4 text-md gap-2 rounded-ctl" : "h-10 px-4 gap-2 rounded-ctl",
    lg: isPhone ? "min-h-12 px-5 text-md gap-2 rounded-ctl" : "h-11 px-5 text-md gap-2 rounded-ctl",
    xl: "min-h-14 px-6 text-lg gap-2.5 rounded-card",
  }[size];
}
const btnBase = "inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,filter,transform] duration-150 active:scale-[0.98] disabled:active:scale-100 disabled:opacity-45 disabled:cursor-not-allowed";

type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; iconRight?: LucideIcon; full?: boolean };
export type ButtonProps = ButtonLook & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>;

/** variant: primary | secondary | outline | ghost | danger | danger-outline | link; size: sm | md | lg | xl */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon: Icon, iconRight: IconR, full, loading, className, children, type = "button", disabled, onClick, ...rest }, ref) {
  const { isPhone } = useView();
  const is = size === "xl" ? 22 : size === "sm" ? 16 : 18;
  const off = disabled && !loading && (variant === "primary" || variant === "danger");
  return (
    // while busy the button keeps focus (a disabled button drops it to the page) and ignores presses
    <button ref={ref} type={type} disabled={disabled} aria-disabled={loading || undefined} aria-busy={loading || undefined} data-variant={variant}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      aria-label={Icon && typeof children === "string" && !rest["aria-label"] ? children : undefined}
      className={cn(btnBase, off ? "bg-raised text-muted border border-line disabled:opacity-100 font-semibold" : BTN[variant], btnSize(size, isPhone, variant), full && "w-full", loading && "cursor-progress", className)} {...rest}>
      {loading ? <Loader2 size={is} className="anim-spin" aria-hidden="true" /> : Icon ? <Icon size={is} aria-hidden="true" /> : null}
      {typeof children === "string" ? <span className="btn-label min-w-0 truncate">{children}</span> : children}
      {IconR ? <IconR size={is} aria-hidden="true" /> : null}
    </button>
  );
});

export type ButtonLinkProps = ButtonLook & { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>;

/** A Button that navigates. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink({ to, variant = "secondary", size = "md", icon: Icon, iconRight: IconR, full, className, children, ...rest }, ref) {
  const { isPhone } = useView();
  const is = size === "xl" ? 22 : size === "sm" ? 16 : 18;
  return (
    <Link ref={ref} to={to} data-variant={variant} aria-label={Icon && typeof children === "string" && !rest["aria-label"] ? children : undefined}
      className={cn(btnBase, BTN[variant], btnSize(size, isPhone, variant), full && "w-full", "no-underline", className)} {...rest}>
      {Icon ? <Icon size={is} aria-hidden="true" /> : null}
      {typeof children === "string" ? <span className="btn-label min-w-0 truncate">{children}</span> : children}
      {IconR ? <IconR size={is} aria-hidden="true" /> : null}
    </Link>
  );
});

export type IconButtonProps = { label: string; icon: LucideIcon; variant?: "ghost" | "secondary" | "primary" | "danger"; size?: "sm" | "md"; badge?: number | string } & ButtonHTMLAttributes<HTMLButtonElement>;

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon: Icon, variant = "ghost", size = "md", className, badge, ...rest }, ref) {
  const { isPhone } = useView();
  const dim = isPhone ? "w-11 h-11" : size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const v = {
    ghost: "text-fg2 hover:text-fg hover:bg-raised",
    secondary: "bg-card border border-line text-fg2 hover:text-fg hover:border-muted/50",
    primary: "bg-brand text-onbrand hover:bg-brand-hover",
    danger: "text-neg hover:bg-neg-tint",
  }[variant];
  return (
    <button ref={ref} type="button" aria-label={label} title={label}
      className={cn("relative inline-flex items-center justify-center rounded-ctl shrink-0 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.94] disabled:active:scale-100 disabled:opacity-45", dim, v, className)} {...rest}>
      <Icon size={size === "sm" && !isPhone ? 16 : 20} aria-hidden="true" />
      {badge ? <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-onbrand text-2xs font-bold grid place-items-center tnum">{badge}</span> : null}
    </button>
  );
});

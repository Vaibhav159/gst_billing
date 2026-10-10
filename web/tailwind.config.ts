import type { Config } from "tailwindcss";

// The palette replaces Tailwind's defaults (theme.colors, not extend): only the app's own tokens
// exist, so a stray `text-amber-500` styles nothing instead of drifting from the look. The tokens are
// RGB channels in src/styles.css, one set per theme; Obsidian is the bare :root.
const t = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      black: "#000",
      white: "#fff",
      ground: t("ground"),
      bar: t("bar"),
      card: t("card"),
      field: t("field"),
      raised: t("raised"),
      line: t("line"),
      "ctl-line": t("ctl-line"),
      rule: t("rule"),
      fg: t("fg"),
      fg2: t("fg2"),
      muted: t("muted"),
      brand: { DEFAULT: t("brand"), hover: t("brand-hover"), tint: t("brand-tint"), line: t("brand-line"), sel: t("brand-sel") },
      onbrand: t("onbrand"),
      amber: { DEFAULT: t("amber"), tint: t("amber-tint"), line: t("amber-line") },
      sale: { DEFAULT: t("sale"), tint: t("sale-tint"), line: t("sale-line") },
      neg: { DEFAULT: t("neg"), tint: t("neg-tint"), line: t("neg-line") },
      danger: t("danger"),
      file: { DEFAULT: t("file"), tint: t("file-tint"), line: t("file-line") },
      scrim: t("scrim"),
    },
    fontFamily: {
      sans: ["system-ui", "-apple-system", "Segoe UI", "Noto Sans", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    fontSize: {
      "2xs": ["11px", "14px"],
      xs: ["12px", "16px"],
      sm: ["13px", "18px"],
      base: ["14px", "20px"],
      md: ["15px", "22px"],
      lg: ["17px", "24px"],
      xl: ["20px", "28px"],
      "2xl": ["24px", "30px"],
      "3xl": ["28px", "34px"],
      "4xl": ["34px", "40px"],
      "5xl": ["42px", "48px"],
    },
    borderRadius: {
      none: "0",
      sm: "6px",
      DEFAULT: "8px",
      md: "10px",
      ctl: "12px",
      card: "14px",
      xl: "18px",
      phone: "44px",
      full: "9999px",
    },
    extend: {
      boxShadow: {
        pop: "var(--shadow-pop)",
        frame: "var(--shadow-frame)",
      },
      minHeight: { 11: "44px", 12: "48px", 14: "56px" },
      minWidth: { 11: "44px" },
      letterSpacing: { caps: "0.06em" },
      zIndex: { nav: "20", sheet: "40", toast: "60", pop: "50" },
    },
  },
  plugins: [],
} satisfies Config;

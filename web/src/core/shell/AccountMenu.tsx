import { useState } from "react";
import { Keyboard, LogOut, Palette as PaletteIcon, Settings as SettingsIcon, Type, UserRound } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { THEMES, TEXT_SIZES, useTextSize, useTheme } from "@/core/device";
import { Avatar, ConfirmDialog, Menu, type MenuItem } from "@/core/ui";

/** Who is signed in, their pages, this device's theme and text size, and Sign out (asked first). */
export function AccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { me, can, signOut } = useAuth();
  const [theme, setTheme] = useTheme();
  const [textSize, setTextSize] = useTextSize();
  const [leaving, setLeaving] = useState(false);
  const items: MenuItem[] = [
    { heading: `${me?.fullName} · ${me?.roleLabel}` },
    { label: "Profile and password", icon: UserRound, to: "/profile" },
    ...(can("settings.edit") ? [{ label: "Settings", icon: SettingsIcon, to: "/settings" }] : []),
    { label: "Keyboard shortcuts", icon: Keyboard, onSelect: onShortcuts },
    { heading: "Theme · on this device" },
    ...THEMES.map((t) => ({ label: t.label, icon: PaletteIcon, checked: theme === t.value, onSelect: () => setTheme(t.value) })),
    { heading: "Text size · on this device" },
    ...TEXT_SIZES.map((t) => ({ label: t.label, hint: t.hint, icon: Type, checked: textSize === t.value, onSelect: () => setTextSize(t.value) })),
    { divider: true },
    { label: "Sign out", icon: LogOut, onSelect: () => setLeaving(true) },
  ];
  return (
    <>
      <Menu width={260} title="Account" items={items}
        trigger={(p) => <button {...p} type="button" aria-label={`Account: ${me?.fullName}`} className="rounded-full"><Avatar name={me?.fullName ?? ""} size={36} /></button>} />
      {/* signed out, the app's sign-in check takes this tab to the sign-in page */}
      <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} onConfirm={() => { setLeaving(false); signOut(); }}
        title="Sign out?" confirmLabel="Sign out" cancelLabel="Stay signed in">
        <p>You'll need your password to sign in again.</p>
      </ConfirmDialog>
    </>
  );
}

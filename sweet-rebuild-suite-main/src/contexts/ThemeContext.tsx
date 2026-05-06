import React, { createContext, useContext, useState, useEffect } from "react";

type Theme = "obsidian" | "pearl" | "sapphire" | "ember" | "forest";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "obsidian",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("gst-theme") as Theme;
    // Migrate old theme names
    if (stored === "dark-navy" as any || stored === "dark-vibrant" as any) return "obsidian";
    if (stored === "light-clean" as any) return "pearl";
    return stored || "obsidian";
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("gst-theme", t);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

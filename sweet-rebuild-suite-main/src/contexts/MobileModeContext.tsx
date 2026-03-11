import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type MobileMode = "easy" | "expert";

interface MobileModeContextType {
  mobileMode: MobileMode;
  setMobileMode: (mode: MobileMode) => void;
}

const MobileModeContext = createContext<MobileModeContextType>({
  mobileMode: "easy",
  setMobileMode: () => {},
});

export function MobileModeProvider({ children }: { children: ReactNode }) {
  const [mobileMode, setMobileModeState] = useState<MobileMode>(() => {
    const stored = localStorage.getItem("mobile-mode");
    return (stored === "easy" || stored === "expert") ? stored : "easy";
  });

  const setMobileMode = (mode: MobileMode) => {
    setMobileModeState(mode);
    localStorage.setItem("mobile-mode", mode);
  };

  return (
    <MobileModeContext.Provider value={{ mobileMode, setMobileMode }}>
      {children}
    </MobileModeContext.Provider>
  );
}

export function useMobileMode() {
  return useContext(MobileModeContext);
}

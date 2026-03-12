import { useState } from "react";
import TopNavbar from "./TopNavbar";
import AnimatedOutlet from "./AnimatedOutlet";
import { currentFY } from "@/utils/mockData";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileHeader from "./mobile/MobileHeader";
import MobileBottomNav from "./mobile/MobileBottomNav";
import EasyHeader from "./mobile/easy/EasyHeader";
import EasyBottomNav from "./mobile/easy/EasyBottomNav";
import { MobileModeProvider, useMobileMode } from "@/contexts/MobileModeContext";

export const FYContext = { selectedFY: currentFY };

function AppLayoutInner() {
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const isMobile = useIsMobile();
  const { mobileMode } = useMobileMode();
  FYContext.selectedFY = selectedFY;

  const isEasy = isMobile && mobileMode === "easy";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {isMobile ? (
        isEasy ? (
          <EasyHeader selectedFY={selectedFY} onFYChange={setSelectedFY} />
        ) : (
          <MobileHeader selectedFY={selectedFY} onFYChange={setSelectedFY} />
        )
      ) : (
        <TopNavbar selectedFY={selectedFY} onFYChange={setSelectedFY} />
      )}
      <main className={`flex-1 overflow-auto ${isMobile ? "pb-20" : ""}`}>
        <div className="max-w-[1440px] mx-auto">
          <AnimatedOutlet context={{ selectedFY, setSelectedFY }} />
        </div>
      </main>
      {isMobile && (isEasy ? <EasyBottomNav /> : <MobileBottomNav />)}
    </div>
  );
}

export default function AppLayout() {
  return (
    <MobileModeProvider>
      <AppLayoutInner />
    </MobileModeProvider>
  );
}

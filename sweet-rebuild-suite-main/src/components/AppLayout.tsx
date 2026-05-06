import { useState, useEffect } from "react";
import TopNavbar from "./TopNavbar";
import AnimatedOutlet from "./AnimatedOutlet";
import { currentFY } from "@/utils/mockData";
import OfflineBanner from "./OfflineBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileHeader from "./mobile/MobileHeader";
import MobileBottomNav from "./mobile/MobileBottomNav";
import EasyHeader from "./mobile/easy/EasyHeader";
import EasyBottomNav from "./mobile/easy/EasyBottomNav";
import { MobileModeProvider, useMobileMode } from "@/contexts/MobileModeContext";
import SkipToContent from "./SkipToContent";
import ErrorBoundary from "./ErrorBoundary";

export const FYContext = { selectedFY: currentFY };

function AppLayoutInner() {
  const [selectedFY, setSelectedFY] = useState(() => {
    return localStorage.getItem('gst_selected_fy') || currentFY;
  });

  useEffect(() => {
    localStorage.setItem('gst_selected_fy', selectedFY);
  }, [selectedFY]);

  const isMobile = useIsMobile();
  const { mobileMode } = useMobileMode();
  FYContext.selectedFY = selectedFY;

  const isEasy = isMobile && mobileMode === "easy";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SkipToContent />
      <OfflineBanner />
      {isMobile ? (
        isEasy ? (
          <EasyHeader selectedFY={selectedFY} onFYChange={setSelectedFY} />
        ) : (
          <MobileHeader selectedFY={selectedFY} onFYChange={setSelectedFY} />
        )
      ) : (
        <TopNavbar selectedFY={selectedFY} onFYChange={setSelectedFY} />
      )}
      <main id="main-content" className={`flex-1 overflow-auto ${isMobile ? "pb-20" : ""}`}>
        <ErrorBoundary>
          <div className="max-w-[1440px] mx-auto">
            <AnimatedOutlet context={{ selectedFY, setSelectedFY }} />
          </div>
        </ErrorBoundary>
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

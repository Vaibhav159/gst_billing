import { useRef, useState, useCallback, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { cn } from "@/utils/utils";

interface SwipeAction {
  icon: ReactNode;
  label: string;
  color: string;
  bg: string;
  onClick: () => void;
}

interface SwipeableCardProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  className?: string;
}

const ACTION_WIDTH = 72;

export default function SwipeableCard({ children, leftActions = [], rightActions = [], className }: SwipeableCardProps) {
  const x = useMotionValue(0);
  const [swiped, setSwiped] = useState<"left" | "right" | null>(null);

  const maxLeft = rightActions.length * ACTION_WIDTH;
  const maxRight = leftActions.length * ACTION_WIDTH;

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const threshold = ACTION_WIDTH * 0.6;
    if (info.offset.x < -threshold && rightActions.length > 0) {
      setSwiped("left");
    } else if (info.offset.x > threshold && leftActions.length > 0) {
      setSwiped("right");
    } else {
      setSwiped(null);
    }
  }, [leftActions.length, rightActions.length]);

  const close = useCallback(() => setSwiped(null), []);

  const getX = () => {
    if (swiped === "left") return -maxLeft;
    if (swiped === "right") return maxRight;
    return 0;
  };

  return (
    <div className={cn("relative overflow-hidden rounded-xl", className)}>
      {/* Right actions (revealed on swipe left) */}
      {rightActions.length > 0 && (
        <div className="absolute right-0 top-0 bottom-0 flex">
          {rightActions.map((action, i) => (
            <button
              key={i}
              onClick={() => { action.onClick(); close(); }}
              className={cn("flex flex-col items-center justify-center gap-1 transition-colors", action.bg)}
              style={{ width: ACTION_WIDTH }}
              aria-label={action.label}
            >
              {action.icon}
              <span className={cn("text-[9px] font-semibold", action.color)}>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Left actions (revealed on swipe right) */}
      {leftActions.length > 0 && (
        <div className="absolute left-0 top-0 bottom-0 flex">
          {leftActions.map((action, i) => (
            <button
              key={i}
              onClick={() => { action.onClick(); close(); }}
              className={cn("flex flex-col items-center justify-center gap-1 transition-colors", action.bg)}
              style={{ width: ACTION_WIDTH }}
              aria-label={action.label}
            >
              {action.icon}
              <span className={cn("text-[9px] font-semibold", action.color)}>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -maxLeft, right: maxRight }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        animate={{ x: getX() }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={swiped ? close : undefined}
        className="relative z-10 bg-[hsl(var(--elevated-bg))]"
        style={{ x }}
      >
        {children}
      </motion.div>
    </div>
  );
}

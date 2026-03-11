import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: string;
  className?: string;
}

export default function AnimatedCounter({ value, className }: AnimatedCounterProps) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    // Extract numeric part for animation
    const numMatch = value.match(/([\d,.]+)/);
    const prevMatch = prevRef.current.match(/([\d,.]+)/);

    if (!numMatch || !prevMatch) {
      setDisplayed(value);
      prevRef.current = value;
      return;
    }

    const target = parseFloat(numMatch[1].replace(/,/g, ""));
    const start = parseFloat(prevMatch[1].replace(/,/g, ""));
    const prefix = value.slice(0, value.indexOf(numMatch[1]));
    const suffix = value.slice(value.indexOf(numMatch[1]) + numMatch[1].length);
    const duration = 600;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * eased;

      // Format with commas
      const formatted = current.toLocaleString("en-IN", {
        maximumFractionDigits: numMatch[1].includes(".") ? 2 : 0,
        minimumFractionDigits: numMatch[1].includes(".") ? 2 : 0,
      });

      setDisplayed(`${prefix}${formatted}${suffix}`);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
    prevRef.current = value;
  }, [value]);

  return <span className={className}>{displayed}</span>;
}

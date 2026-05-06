import { useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/utils/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onStartChange: (date: Date) => void;
  onEndChange: (date: Date) => void;
  fyStart?: number; // e.g. 2024
  className?: string;
}

export default function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, fyStart, className }: DateRangePickerProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const now = new Date();
  const fy = fyStart || now.getFullYear();

  const presets = [
    { label: "This Month", apply: () => { onStartChange(startOfMonth(now)); onEndChange(endOfMonth(now)); } },
    { label: "Last Month", apply: () => { const prev = subMonths(now, 1); onStartChange(startOfMonth(prev)); onEndChange(endOfMonth(prev)); } },
    { label: "This Quarter", apply: () => { onStartChange(startOfQuarter(now)); onEndChange(endOfQuarter(now)); } },
    { label: "Full FY", apply: () => { onStartChange(new Date(fy, 3, 1)); onEndChange(new Date(fy + 1, 2, 31)); } },
  ];

  const isPresetActive = (preset: typeof presets[0]) => {
    if (preset.label === "Full FY") {
      return startDate.getMonth() === 3 && startDate.getDate() === 1 && startDate.getFullYear() === fy
        && endDate.getMonth() === 2 && endDate.getDate() === 31 && endDate.getFullYear() === fy + 1;
    }
    if (preset.label === "This Month") {
      const s = startOfMonth(now);
      const e = endOfMonth(now);
      return startDate.getTime() === s.getTime() && endDate.getTime() === e.getTime();
    }
    if (preset.label === "Last Month") {
      const prev = subMonths(now, 1);
      const s = startOfMonth(prev);
      const e = endOfMonth(prev);
      return startDate.getTime() === s.getTime() && endDate.getTime() === e.getTime();
    }
    if (preset.label === "This Quarter") {
      const s = startOfQuarter(now);
      const e = endOfQuarter(now);
      return startDate.getTime() === s.getTime() && endDate.getTime() === e.getTime();
    }
    return false;
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Presets */}
      <div className="flex items-center gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={p.apply}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border",
              isPresetActive(p)
                ? "bg-primary/15 border-primary/30 text-primary"
                : "bg-muted/50 border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Start date */}
      <Popover open={startOpen} onOpenChange={setStartOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5 font-normal">
            <CalendarIcon className="w-3.5 h-3.5" />
            {format(startDate, "dd MMM yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={startDate}
            onSelect={(d) => { if (d) { onStartChange(d); setStartOpen(false); } }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      <span className="text-[11px] text-muted-foreground">to</span>

      {/* End date */}
      <Popover open={endOpen} onOpenChange={setEndOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5 font-normal">
            <CalendarIcon className="w-3.5 h-3.5" />
            {format(endDate, "dd MMM yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={endDate}
            onSelect={(d) => { if (d) { onEndChange(d); setEndOpen(false); } }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

import { SlidersHorizontal } from "lucide-react";
import BottomSheet from "./BottomSheet";

interface FilterOption {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterOption[];
  onClear: () => void;
  title?: string;
}

export default function MobileFilterSheet({ open, onOpenChange, filters, onClear, title = "Filters" }: Props) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      titleIcon={<SlidersHorizontal className="w-4 h-4 text-primary" />}
      actions={<button onClick={onClear} className="text-[12px] text-destructive font-medium">Clear All</button>}
    >
      <div className="p-5 space-y-5">
        {filters.map((filter) => (
          <div key={filter.label} className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{filter.label}</label>
            <select
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              className="premium-select w-full h-12 text-[14px]"
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="p-5 pt-0">
        <button
          onClick={() => onOpenChange(false)}
          className="premium-btn-primary w-full h-12 text-[14px]"
        >
          Apply Filters
        </button>
      </div>
    </BottomSheet>
  );
}

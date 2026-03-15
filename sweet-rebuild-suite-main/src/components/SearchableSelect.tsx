import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/utils/utils";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search...",
  className,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => String(o.value) === String(value));

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx]);

  const open = () => {
    // Decide whether to open upward or downward
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropdownHeight = 240; // approx max-h-48 (192px) + search bar (~48px)
      setOpenUpward(spaceBelow < dropdownHeight && rect.top > dropdownHeight);
    }
    setIsOpen(true);
    setHighlightIdx(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const select = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((p) => (p + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((p) => (p <= 0 ? filtered.length - 1 : p - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && filtered[highlightIdx]) {
        select(filtered[highlightIdx].value);
      } else if (filtered.length === 1) {
        select(filtered[0].value);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearch("");
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className={cn(
          "premium-select w-full text-left flex items-center justify-between gap-2",
          !selectedOption && "text-muted-foreground"
        )}
      >
        <span className="truncate text-[13px]">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", isOpen && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className={cn(
          "absolute z-50 w-full bg-popover border border-border/60 rounded-xl shadow-xl overflow-hidden animate-in fade-in duration-150",
          openUpward ? "bottom-full mb-1 slide-in-from-bottom-1" : "top-full mt-1 slide-in-from-top-1"
        )}>
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setHighlightIdx(-1); }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-48 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">No results found</div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  onClick={() => select(opt.value)}
                  className={cn(
                    "px-3 py-2 cursor-pointer text-[13px] text-foreground transition-colors flex items-center justify-between",
                    "hover:bg-primary/8",
                    idx === highlightIdx && "bg-primary/10",
                    opt.value === value && "font-semibold text-primary"
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.sublabel && <span className="text-[10px] text-muted-foreground font-mono ml-2 shrink-0">{opt.sublabel}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

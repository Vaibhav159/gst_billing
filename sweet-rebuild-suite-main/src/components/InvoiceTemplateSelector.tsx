import { cn } from "@/utils/utils";
import { Check, Palette } from "lucide-react";

export type InvoiceTemplate = "classic" | "modern" | "minimal" | "detailed" | "tally";

interface InvoiceTemplateSelectorProps {
  selected: InvoiceTemplate;
  onChange: (template: InvoiceTemplate) => void;
}

const templates: { id: InvoiceTemplate; name: string; desc: string; preview: string }[] = [
  {
    id: "classic",
    name: "Classic",
    desc: "Traditional business layout with serif fonts",
    preview: "border-t-4 border-t-gray-800",
  },
  {
    id: "modern",
    name: "Modern",
    desc: "Clean design with accent colors",
    preview: "border-t-4 border-t-blue-500",
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Simple and elegant with lots of whitespace",
    preview: "border-t-2 border-t-gray-300",
  },
  {
    id: "detailed",
    name: "Detailed",
    desc: "Full info with bank details and terms",
    preview: "border-t-4 border-t-emerald-600",
  },
  {
    id: "tally",
    name: "Tally Classic",
    desc: "Bordered table layout matching Tally GST invoices",
    preview: "border-2 border-gray-900",
  },
];

/** Read/write the invoice template preference from localStorage */
export function getStoredTemplate(): InvoiceTemplate {
  return (localStorage.getItem("invoice-template") as InvoiceTemplate) || "tally";
}
export function setStoredTemplate(t: InvoiceTemplate) {
  localStorage.setItem("invoice-template", t);
}

export default function InvoiceTemplateSelector({ selected, onChange }: InvoiceTemplateSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "relative rounded-xl p-4 text-left transition-all border-2",
              selected === t.id
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border/40 hover:border-primary/30 bg-card"
            )}
          >
            {selected === t.id && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Check className="w-3 h-3 text-primary-foreground" />
              </div>
            )}
            {/* Mini preview */}
            <div className={cn("w-full h-16 rounded-lg bg-white mb-3 shadow-sm", t.preview)}>
              <div className="p-2 space-y-1">
                <div className="h-1.5 w-12 bg-gray-300 rounded" />
                <div className="h-1 w-20 bg-gray-200 rounded" />
                <div className="h-1 w-16 bg-gray-200 rounded" />
                <div className="flex gap-1 mt-1.5">
                  <div className="h-1 flex-1 bg-gray-100 rounded" />
                  <div className="h-1 w-6 bg-gray-300 rounded" />
                </div>
              </div>
            </div>
            <p className="text-[12px] font-semibold text-foreground">{t.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

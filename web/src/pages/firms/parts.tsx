import { AlertTriangle, Check, Lock } from "lucide-react";
import type { ReturnState } from "@/core/api/firms";
import { Badge, cn } from "@/core/ui";
export function ReturnBadge({ state, blocker = "", short = false }: { state: ReturnState; blocker?: string; short?: boolean }) {
  if (state === "filed") return <Badge tone="file" icon={Lock}>Filed</Badge>;
  if (state === "blocked") return <Badge tone="neg" icon={AlertTriangle}>GSTR-1 blocked{!short && blocker ? ` · ${blocker}` : ""}</Badge>;
  if (state === "ready") return <Badge tone="sale" icon={Check}>Ready to file</Badge>;
  if (state === "gstr1") return <Badge tone="file">GSTR-1 filed</Badge>;
  if (state === "unlocked") return <Badge tone="amber">Unlocked</Badge>;
  return <Badge>{state === "open" ? "Open" : "Not started"}</Badge>;
}
/** The actual signature, or the blank line, as it prints. Never invent a signature. */
export function SignaturePreview({ name, image, on, className }: { name: string; image: string | null; on: boolean; className?: string }) {
  return <div role="img" className={cn("rounded-ctl border border-line bg-white text-[#111] px-4 py-3 flex flex-col items-end gap-1 min-h-[104px] justify-between", className)} aria-label={`How the signature will print${name ? ` for ${name}` : ""}: ${on && image ? "the picture uploaded" : "a blank line, signed by hand"}, above “Authorised Signatory”`}>
    <span className="text-xs font-bold" aria-hidden="true">for {name || "your firm"}</span>
    {on && image ? <img src={image} alt="" className="max-h-12 max-w-[180px] object-contain" /> : <span className="text-xs text-[#555] italic" aria-hidden="true">blank line, signed by hand</span>}
    <span className="text-xs" aria-hidden="true">Authorised Signatory</span>
  </div>;
}

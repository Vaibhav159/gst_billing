// /scan: the bills list's QR check on a page of its own (Ruling 1E-7), for More's "Check a bill's QR code" and v2's QR
// scanner link (/billing/qr-scanner). A page rather than the list under a dialog: on a phone the camera has the screen,
// Back goes where the person came from, and the list's bills aren't asked for only to sit behind it. PROTO's /scan words.
import { useRef } from "react";
import { useNavigate } from "react-router";
import { QrCode } from "lucide-react";
import { Card, Page } from "@/core/ui";
import { QrCheck } from "./QrCheck";

export default function ScanPage() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Page icon={QrCode} title="Check a bill's QR code" breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales" phoneSubtitle="Bills printed by this app"
      context="Is a printed bill really one of yours, unchanged? Scan its QR code, or type what it says.">
      <Card className="w-full max-w-[580px]"><QrCheck input={input} go={(to) => navigate(to)} /></Card>
    </Page>
  );
}

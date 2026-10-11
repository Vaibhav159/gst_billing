// /scan: the bills list's QR check on a page of its own (Ruling 1E-7), for More's "Check a bill's QR code" and v2's QR
// scanner link (/billing/qr-scanner). A page rather than the list under a dialog: on a phone the camera has the screen,
// Back goes where the person came from, and the list's bills aren't asked for only to sit behind it. PROTO's /scan words.
import { useRef } from "react";
import { useNavigate } from "react-router";
import { QrCode } from "lucide-react";
import { Card, Page } from "@/core/ui";
import { useView } from "@/core/view";
import { QrCheck } from "./QrCheck";

export default function ScanPage() {
  const navigate = useNavigate();
  const { isPhone } = useView();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Page icon={QrCode} title="Check a bill's QR code" breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales" phoneSubtitle="Bills printed by this app"
      context="Is a printed bill really one of yours, unchanged? Scan its QR code, or type what it says.">
      {/* on a computer the page's title has the focus, as every page's does, so the card says how a USB scanner reads in */}
      <Card className="w-full max-w-[580px]" title={isPhone ? undefined : "Scan"} subtitle={isPhone ? undefined : "A USB scanner works like a keyboard: click the field and scan."}>
        <QrCheck input={input} go={(to) => navigate(to)} />
      </Card>
    </Page>
  );
}

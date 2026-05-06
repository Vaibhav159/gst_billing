import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";

interface InvoiceQRCodeProps {
  invoiceNumber: string;
  total: number;
  businessName: string;
  upiId?: string;
  size?: number;
  showLabel?: boolean;
}

export default function InvoiceQRCode({
  invoiceNumber,
  total,
  businessName,
  upiId,
  size = 100,
  showLabel = true,
}: InvoiceQRCodeProps) {
  // Generate UPI payment QR or invoice info QR
  const qrValue = upiId
    ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(businessName)}&am=${total}&tn=${encodeURIComponent(`Payment for ${invoiceNumber}`)}&cu=INR`
    : JSON.stringify({
        inv: invoiceNumber,
        amt: total,
        biz: businessName,
        dt: new Date().toISOString().split("T")[0],
      });

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="p-2 bg-white rounded-lg border border-gray-200">
        <QRCodeSVG
          value={qrValue}
          size={size}
          level="M"
          includeMargin={false}
        />
      </div>
      {showLabel && (
        <div className="text-center">
          <p className="text-[9px] text-gray-500 font-medium flex items-center gap-1 justify-center">
            <QrCode className="w-3 h-3" />
            {upiId ? "Scan to Pay via UPI" : "Invoice Details"}
          </p>
        </div>
      )}
    </div>
  );
}

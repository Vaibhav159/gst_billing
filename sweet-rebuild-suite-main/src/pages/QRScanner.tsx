import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import {
  QrCode, Camera, CameraOff, CheckCircle2, XCircle, ArrowLeft,
  FileText, Search, Loader2, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency, formatDate } from "@/utils/mockData";
import api from "@/utils/api";
import { mapDjangoInvoice } from "@/hooks/useDataStore";
import type { Invoice } from "@/utils/mockData";

type ScanResult = {
  invoiceNumber: string;
  gstNumber: string;
  date: string;
  total: string;
};

type VerifyState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "searching"; data: ScanResult }
  | { status: "found"; data: ScanResult; invoice: Invoice }
  | { status: "not_found"; data: ScanResult };

export default function QRScanner() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [cameraActive, setCameraActive] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>({ status: "idle" });
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const parseScanData = (raw: string): ScanResult | null => {
    // Format: invoiceNumber|gstNumber|date|total
    const parts = raw.split("|");
    if (parts.length >= 4) {
      return {
        invoiceNumber: parts[0],
        gstNumber: parts[1],
        date: parts[2],
        total: parts[3],
      };
    }
    // Try JSON format from InvoiceQRCode component
    try {
      const json = JSON.parse(raw);
      if (json.inv) {
        return {
          invoiceNumber: json.inv,
          gstNumber: "",
          date: json.dt || "",
          total: String(json.amt || ""),
        };
      }
    } catch { /* not JSON */ }
    return null;
  };

  const lookupInvoice = async (data: ScanResult) => {
    setVerifyState({ status: "searching", data });
    try {
      const res = await api.get<any>(`invoices/?search=${encodeURIComponent(data.invoiceNumber)}&page_size=5`);
      const results = Array.isArray(res.data) ? res.data : (res.data.results || []);
      const mapped = results.map(mapDjangoInvoice);
      const match = mapped.find(
        (inv: Invoice) => inv.invoiceNumber === data.invoiceNumber
      );
      if (match) {
        setVerifyState({ status: "found", data, invoice: match });
      } else {
        setVerifyState({ status: "not_found", data });
      }
    } catch {
      setVerifyState({ status: "not_found", data });
    }
  };

  const startScanner = async () => {
    if (!containerRef.current) return;
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      setCameraActive(true);
      setVerifyState({ status: "scanning" });
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          const data = parseScanData(decodedText);
          if (data) {
            stopScanner();
            lookupInvoice(data);
          }
        },
        () => { /* ignore errors during scanning */ }
      );
    } catch (err) {
      console.error("Camera error", err);
      setCameraActive(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  const resetScan = () => {
    setVerifyState({ status: "idle" });
    stopScanner();
  };

  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  return (
    <div className={cn("space-y-6 max-w-3xl mx-auto animate-fade-in", isMobile ? "p-4 pb-24" : "p-6 lg:p-8")}>
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "QR Scanner" }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center">
          <QrCode className="w-5 h-5 text-chart-3" />
        </div>
        <div>
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>
            Invoice QR Scanner
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scan a QR code from a printed invoice to verify it
          </p>
        </div>
      </div>

      {/* Scanner Area */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        <div className="p-6 space-y-4">
          {/* Camera Preview */}
          <div
            ref={containerRef}
            className={cn(
              "relative rounded-xl overflow-hidden bg-black/95 mx-auto",
              isMobile ? "aspect-square max-w-[300px]" : "aspect-square max-w-[400px]"
            )}
          >
            <div id="qr-reader" className="w-full h-full" />
            {!cameraActive && verifyState.status === "idle" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-secondary/20">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Camera className="w-8 h-8 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Start camera to scan</p>
              </div>
            )}
            {cameraActive && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="w-[250px] h-[250px] border-2 border-primary/50 rounded-lg relative"
                  >
                    {/* Corner accents */}
                    <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl" />
                    <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr" />
                    <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br" />
                    {/* Scanning line */}
                    <motion.div
                      initial={{ top: 0 }}
                      animate={{ top: "100%" }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
                    />
                  </motion.div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {!cameraActive && verifyState.status === "idle" && (
              <button onClick={startScanner} className="premium-btn-primary text-[13px] gap-2">
                <Camera className="w-4 h-4" /> Start Scanner
              </button>
            )}
            {cameraActive && (
              <button onClick={stopScanner} className="premium-btn-outline text-[13px] gap-2 border-destructive/30 text-destructive">
                <CameraOff className="w-4 h-4" /> Stop Scanner
              </button>
            )}
            {(verifyState.status === "found" || verifyState.status === "not_found") && (
              <button onClick={() => { resetScan(); setTimeout(startScanner, 200); }} className="premium-btn-ghost text-[13px] gap-2">
                <RefreshCw className="w-4 h-4" /> Scan Again
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Result Area */}
      <AnimatePresence mode="wait">
        {verifyState.status === "searching" && (
          <motion.div
            key="searching"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="elevated-card rounded-2xl p-6"
          >
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Looking up invoice <span className="font-semibold text-foreground">{verifyState.data.invoiceNumber}</span>...
              </p>
            </div>
          </motion.div>
        )}

        {verifyState.status === "found" && (
          <motion.div
            key="found"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="elevated-card rounded-2xl overflow-hidden border-success/30"
          >
            <div className="bg-success/8 px-6 py-4 border-b border-success/20 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <div>
                <h3 className="text-sm font-display font-bold text-success">Invoice Verified</h3>
                <p className="text-xs text-muted-foreground">This invoice was found in your records</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Invoice #</p>
                  <p className="font-semibold text-primary">{verifyState.invoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Date</p>
                  <p className="font-medium">{formatDate(verifyState.invoice.invoice_date)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Customer</p>
                  <p className="font-medium">{verifyState.invoice.customerName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Amount</p>
                  <p className="font-display font-bold text-foreground">{formatCurrency(verifyState.invoice.total)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</p>
                  <span className={cn("premium-badge text-[10px]", verifyState.invoice.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>
                    {verifyState.invoice.type}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Items</p>
                  <p className="font-medium">{verifyState.invoice.lineItemCount}</p>
                </div>
              </div>

              {/* QR vs Actual comparison */}
              {verifyState.data.total && Number(verifyState.data.total) !== verifyState.invoice.total && (
                <div className="bg-warning/8 border border-warning/20 rounded-xl p-3 text-xs text-warning">
                  ⚠️ QR total (₹{verifyState.data.total}) differs from actual total ({formatCurrency(verifyState.invoice.total)})
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Link
                  to={`/billing/invoice/${verifyState.invoice.id}`}
                  className="premium-btn-primary text-[12px] flex-1"
                >
                  <FileText className="w-4 h-4" /> View Invoice
                </Link>
                <Link
                  to={`/billing/invoice/${verifyState.invoice.id}/print`}
                  className="premium-btn-ghost text-[12px]"
                >
                  Print
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {verifyState.status === "not_found" && (
          <motion.div
            key="not_found"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="elevated-card rounded-2xl overflow-hidden border-destructive/30"
          >
            <div className="bg-destructive/8 px-6 py-4 border-b border-destructive/20 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-destructive" />
              <div>
                <h3 className="text-sm font-display font-bold text-destructive">Invoice Not Found</h3>
                <p className="text-xs text-muted-foreground">No matching invoice in your records</p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Scanned Invoice #</p>
                  <p className="font-semibold text-foreground">{verifyState.data.invoiceNumber}</p>
                </div>
                {verifyState.data.gstNumber && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">GSTIN</p>
                    <p className="font-mono text-xs">{verifyState.data.gstNumber}</p>
                  </div>
                )}
                {verifyState.data.date && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Date</p>
                    <p className="font-medium">{verifyState.data.date}</p>
                  </div>
                )}
                {verifyState.data.total && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
                    <p className="font-medium">₹{verifyState.data.total}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* How it works */}
      {verifyState.status === "idle" && (
        <div className="elevated-card rounded-2xl p-5 space-y-3">
          <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
          <ol className="space-y-2.5 text-[12px] text-muted-foreground">
            {[
              "Click \"Start Scanner\" to activate your camera",
              "Point the camera at the QR code on a printed invoice",
              "The scanner will automatically detect and decode the QR",
              "The invoice will be verified against your records",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-lg bg-chart-3/10 flex items-center justify-center text-[10px] font-bold text-chart-3 shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

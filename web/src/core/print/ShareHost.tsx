// A phone's share sheet opens only within a person's press. Making a PDF can outlast the press (the first time,
// react-pdf has to load), so when it does, this asks for one more press: "Your PDF is ready · Share". It also gives
// sends and shares that run outside React (deliver) a way to say what happened. Mounted once, in the app's layout.
import { useCallback, useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button, Dialog, useToast, type ToastApi, type ToastInput } from "@/core/ui";
import { shareFile } from "./files";
import type { PdfFile } from "./make";

type Shared = "shared" | "cancelled" | "unsupported";
type Ask = { file: PdfFile; title: string; text?: string; done: (r: Shared) => void };
let asker: ((a: Ask) => void) | null = null;
let teller: Pick<ToastApi, "show" | "dismiss"> | null = null;

/**
 * The share sheet with the PDF: at once while the press still counts, else after the host's own Share press.
 * "unsupported": this browser's share sheet takes no files, or refused even that press (the caller downloads it instead).
 */
export async function sharePdf(file: PdfFile, { title, text }: { title: string; text?: string }): Promise<Shared> {
  const r = await shareFile(file.blob, file.name, { title, text });
  if (r !== "late") return r;
  return new Promise((done) => {
    if (!asker) { done("cancelled"); return; }
    asker({ file, title, text, done });
  });
}

/**
 * A word from code with no screen of its own (a send runs in deliver, outside React), shown by the host. Returns what
 * takes it back once it no longer holds ("Making the PDF…" once the PDF is made); with no host on screen, nothing.
 */
export function tell(t: ToastInput): () => void {
  const host = teller;
  const id = host?.show(t);
  return () => { if (host && id !== undefined) host.dismiss(id); };
}

export function ShareHost() {
  const toasts = useToast();
  const [ask, setAsk] = useState<Ask | null>(null);
  // the ask whose share sheet is up: its Share waits for the sheet to close
  const [sharing, setSharing] = useState<Ask | null>(null);
  // the ask on screen, settled once: by its Share or Not now, a newer ask, or the host leaving the screen
  const current = useRef<Ask | null>(null);
  const settle = useCallback((a: Ask, r: Shared) => {
    if (current.current !== a) return;
    current.current = null;
    setAsk(null);
    setSharing(null); // the host lets the PDF go
    a.done(r);
  }, []);
  useEffect(() => {
    const take = (a: Ask) => {
      const old = current.current;
      if (old) settle(old, "cancelled");
      current.current = a;
      setAsk(a);
    };
    asker = take;
    teller = toasts;
    return () => {
      if (asker === take) asker = null;
      if (teller === toasts) teller = null;
      const a = current.current;
      current.current = null;
      a?.done("cancelled");
    };
  }, [toasts, settle]);
  const shareNow = () => {
    const a = current.current;
    if (!a || sharing === a) return;
    setSharing(a);
    // a share sheet that refuses this press too can't share here
    void shareFile(a.file.blob, a.file.name, { title: a.title, text: a.text }).then((r) => settle(a, r === "shared" || r === "cancelled" ? r : "unsupported"));
  };
  return (
    <Dialog open={Boolean(ask)} onClose={() => { if (ask) settle(ask, "cancelled"); }} title="Your PDF is ready" size="sm"
      footer={<>
        <Button onClick={() => { if (ask) settle(ask, "cancelled"); }}>Not now</Button>
        <Button variant="primary" icon={Share2} loading={Boolean(ask) && sharing === ask} onClick={shareNow}>Share</Button>
      </>}>
      <p className="text-fg2">{ask ? `${ask.file.name} took a moment to make, so the phone asks once more: press Share, then pick WhatsApp or any app.` : ""}</p>
    </Dialog>
  );
}

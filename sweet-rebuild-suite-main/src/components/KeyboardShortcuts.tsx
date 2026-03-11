import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Ctrl+S / Cmd+S — submit nearest form
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const form = document.querySelector("form");
        if (form) {
          form.requestSubmit();
          toast({ title: "⌘S", description: "Form submitted" });
        }
        return;
      }

      // Escape — close topmost modal
      if (e.key === "Escape") {
        const modal = document.querySelector("[data-modal-overlay]");
        if (modal) {
          (modal as HTMLElement).click();
        }
        return;
      }

      if (isInput) return;

      // Single key shortcuts (not in inputs)
      switch (e.key.toLowerCase()) {
        case "n":
          if (!e.ctrlKey && !e.metaKey) { navigate("/billing/invoice/add"); }
          break;
        case "d":
          if (!e.ctrlKey && !e.metaKey) { navigate("/"); }
          break;
        case "c":
          if (!e.ctrlKey && !e.metaKey) { navigate("/billing/customer/list"); }
          break;
        case "i":
          if (!e.ctrlKey && !e.metaKey) { navigate("/billing/invoice/list"); }
          break;
        case "p":
          if (!e.ctrlKey && !e.metaKey) { navigate("/billing/product/list"); }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toast]);

  return null;
}

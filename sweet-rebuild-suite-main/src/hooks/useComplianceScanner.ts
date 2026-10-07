import { useEffect, useRef } from "react";
import { logger } from "@/utils/logger";
import api from "@/utils/api";
import { pushNotification } from "@/hooks/useNotifications";
import { currentFY } from "@/utils/mockData";
import { todayLocal } from "@/utils/localDate";

/**
 * On-demand GST compliance scanner.
 *
 * Hits the gst_summary endpoint once per session (per-day stable IDs make
 * notifications dedup themselves across reloads), turns the result into
 * actionable notifications:
 *
 *   - itc-aging-urgent-{YYYY-MM-DD}   — N invoices ≤ 60 days from Sec 16(4)
 *                                       cutoff (ITC will be forfeit if not
 *                                       claimed)
 *   - itc-aging-expired-{YYYY-MM-DD}  — N invoices already past cutoff
 *
 * (A "GSTR-1 vs 3B mismatch" alert used to sit here. Its variance compared
 * the same sales with themselves, so it could never fire: M29.)
 *
 * The scanner skips silently when:
 *   - user is logged out
 *   - already ran today (gst_compliance_scan_date in localStorage)
 *
 * It runs against the *current* FY. Cross-FY checks are a follow-up — most
 * compliance signals are FY-bound anyway (Sec 16(4) cutoff lives in next FY's
 * Nov 30, but the relevant *invoices* are in the current FY).
 */
export function useComplianceScanner() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!localStorage.getItem("gst_access_token")) return;

    const today = todayLocal();
    const lastScan = localStorage.getItem("gst_compliance_scan_date");
    if (lastScan === today) return;

    const fyStart = parseInt(currentFY.split("-")[0], 10);
    const params = new URLSearchParams({
      start_date: `${fyStart}-04-01`,
      end_date: `${fyStart + 1}-03-31`,
    });

    api.get<any>(`invoices/gst_summary/?${params.toString()}`)
      .then((res) => {
        const data = res.data || {};
        const aging = data.itc_aging?.buckets || {};

        // ITC aging — urgent (≤60 days)
        const urgentCount = aging.fresh?.count || 0;
        if (urgentCount > 0) {
          pushNotification({
            stableId: `itc-aging-urgent-${today}`,
            type: "warning",
            title: `${urgentCount} invoice${urgentCount === 1 ? "" : "s"} near Sec 16(4) cutoff`,
            message: `ITC worth ₹${(aging.fresh?.tax || 0).toLocaleString("en-IN")} will be forfeit within 60 days if not claimed. Open GST → ITC Aging.`,
          });
        }

        // ITC aging — already expired
        const expiredCount = aging.expired?.count || 0;
        if (expiredCount > 0) {
          pushNotification({
            stableId: `itc-aging-expired-${today}`,
            type: "error",
            title: `${expiredCount} invoice${expiredCount === 1 ? "" : "s"} past ITC cutoff`,
            message: `ITC of ₹${(aging.expired?.tax || 0).toLocaleString("en-IN")} is forfeit per Sec 16(4). Review in GST → ITC Aging.`,
          });
        }

        localStorage.setItem("gst_compliance_scan_date", today);
      })
      .catch((e) => logger.warn("Compliance scan failed", e));
  }, []);
}

import { useGstMonth } from "@/core/api/gst";
import { useSalesPage } from "@/core/api/sales";
import { addMonths, monthOf, todayIST } from "@/core/format";

export function useEasyGst(firmId: number | null, today = todayIST()) {
  const month = monthOf(today);
  const previous = useGstMonth(firmId, addMonths(month, -1));
  const current = useSalesPage(firmId, { month }, 1);
  return { previous, current, today, month };
}

import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import type { BillRef } from "./types";
/** Original id opens the existing deleted-bill/bin-row outcome at /sales/:id. */
export function BillReference({ bill }: { bill: BillRef }) {
  const { can } = useAuth();
  const deleted = bill.status === "deleted";
  const words = <>{bill.invoice_number}{deleted ? <> · <span className="text-muted">Deleted</span></> : null}</>;
  return deleted && can("bill.delete") ? <Link to={`/sales/${bill.id}`} className="link tnum">{words}</Link> : <span className="tnum">{words}</span>;
}

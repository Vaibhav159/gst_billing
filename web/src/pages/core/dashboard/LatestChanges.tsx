import { History } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import type { DashboardData } from "@/core/dashboard/types";
import { dateShort } from "@/core/format";
import { dayOf, timeOf } from "@/core/sales/words";
import { Card } from "@/core/ui";

export function LatestChanges({ data }: { data: DashboardData }) {
  const { can } = useAuth();
  if (!can("audit.view") || data.changes === null) return null;
  return <Card title="Latest changes" subtitle="Who did what, newest first" pad={false}>
    <ul className="mt-2">{data.changes.map(e => <li key={e.id} className="px-5 py-2.5 border-t border-rule">
      <p className="text-sm"><span className="font-medium">{e.title}</span></p>
      <p className="text-xs text-muted mt-0.5 truncate">{[e.by?.name, dayOf(e.at) === data.today.date ? timeOf(e.at) : `${dateShort(dayOf(e.at))}, ${timeOf(e.at)}`, e.detail].filter(Boolean).join(" · ")}</p>
    </li>)}</ul>
    <div className="px-5 py-3 border-t border-rule"><Link to="/audit" className="link inline-flex items-center gap-1.5"><History size={15} aria-hidden="true" />Open the Audit log</Link></div>
  </Card>;
}

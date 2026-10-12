import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Camera, LayoutDashboard, Moon, Plus, Sun } from "lucide-react";
import { useDashboard, useDueNext, type DashboardData, type DueData } from "@/core/api/dashboard";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { THEMES, useTheme, type Theme } from "@/core/device";
import { dateLong, dateShort, todayIST } from "@/core/format";
import { useFirms, useScope, type FirmId } from "@/core/scope";
import { FirmChips, fyItems } from "@/core/shell/ScopePickers";
import { readStored, writeStored } from "@/core/storage";
import { DueNextCard } from "@/core/due/DueNextCard";
import { ButtonLink, Card, IconButton, ListSkeleton, LoadError, Menu, Page, QueryView, Skeleton, useToast } from "@/core/ui";
import { useView } from "@/core/view";
import Placeholder from "./Placeholder";
import { TodayCard } from "./dashboard/TodayCard";
import { MonthCard } from "./dashboard/MonthCard";
import { LatestChanges } from "./dashboard/LatestChanges";
import { PastReturnsCard, ReturnsCard } from "./dashboard/ReturnsCard";
import { YearCard } from "./dashboard/YearCard";

/** A URL pick applies once per navigation; a later picker choice must not be overwritten by the old URL. */
function useDashboardScope() {
  const scope = useScope(), firms = useFirms(), location = useLocation();
  const applied = useRef<string | null>(null), key = `${location.key}:${location.search}`;
  const params = new URLSearchParams(location.search), raw = params.get("firm"), year = params.get("fy");
  const wantedFirm: FirmId | undefined = raw === "all" ? "all" : raw && /^\d+$/.test(raw) && firms.firms.some(f => f.id === Number(raw)) ? Number(raw) : undefined;
  const wantedYear = year && scope.fyChoices.includes(year) ? year : undefined;
  const pending = applied.current !== key && ((wantedFirm !== undefined && wantedFirm !== scope.firmId) || (wantedYear !== undefined && wantedYear !== scope.fy));
  useEffect(() => {
    if (firms.loading || firms.error || applied.current === key) return;
    applied.current = key;
    if (wantedFirm !== undefined) scope.setFirmId(wantedFirm);
    if (wantedYear !== undefined) scope.setFy(wantedYear);
  }, [firms.loading, firms.error, key, scope.setFirmId, scope.setFy, wantedFirm, wantedYear]);
  return { ...scope, ...firms, queryFirm: !firms.loading && !firms.error && firms.firms.length && !pending ? scope.firmId : null };
}
function PhoneTools() {
  const scope = useScope(), { show } = useToast(), [theme, setTheme] = useTheme();
  const light = theme === "pearl", past = scope.fy !== scope.fyChoices[0];
  const glare = () => {
    if (!light) { writeStored("gst3.darkTheme", theme); setTheme("pearl"); }
    else { const back = readStored("gst3.darkTheme"); setTheme(THEMES.some(t => t.value === back && back !== "pearl") ? back as Theme : "obsidian"); }
  };
  return <><IconButton label={light ? "Dark screen" : "Bright screen for sunlight"} icon={light ? Moon : Sun} onClick={glare} />
    <Menu title="Financial year" items={fyItems(scope, show)} trigger={p => <button {...p} type="button" aria-label={`Financial year ${scope.fy}`} className={cn("min-h-11 px-3 rounded-full border text-sm tnum", past ? "border-brand text-brand bg-brand-sel" : "border-line bg-card text-fg2")}>FY {scope.fy.slice(2)}</button>} />
  </>;
}
export function DashSkeleton({ phone = false }: { phone?: boolean }) {
  if (phone) return <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading today's figures"><span className="sr-only">Loading today's figures…</span>{[0, 1, 2].map(i => <div key={i} className="card p-4 flex flex-col gap-3"><Skeleton w="40%" h={12} /><Skeleton w="65%" h={28} /><Skeleton h={14} /><Skeleton h={14} /></div>)}</div>;
  return <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading today's figures">
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5"><div className="card p-5 flex flex-col gap-3"><Skeleton w="30%" h={18} />{[0, 1, 2].map(i => <Skeleton key={i} h={16} />)}</div><div className="card p-5 flex flex-col gap-3"><Skeleton w="45%" h={18} />{[0, 1, 2, 3].map(i => <Skeleton key={i} h={14} />)}</div></div>
    <div className="card p-5 grid grid-cols-4 gap-5">{[0, 1, 2, 3].map(i => <div key={i} className="flex flex-col gap-2"><Skeleton w="55%" h={12} /><Skeleton w="80%" h={26} /></div>)}</div>
    <div className="card p-5 flex flex-col gap-3"><Skeleton w="35%" h={18} /><Skeleton h={160} /></div>
  </div>;
}
function DuePanel({ query, phone }: { query: UseQueryResult<DueData>; phone: boolean }) {
  if (!query.data) return <Card title="Due next"><QueryView query={query} what="due next" skeleton={<ListSkeleton rows={phone ? 4 : 6} what="due next" />}>{() => null}</QueryView></Card>;
  return <QueryView query={query} what="due next">{data => <DueNextCard data={data} phone={phone} />}</QueryView>;
}
function ReturnsPanel({ query, phone }: { query: UseQueryResult<DueData>; phone: boolean }) {
  if (!query.data) return <Card title="Returns"><QueryView query={query} what="returns" skeleton={<ListSkeleton rows={3} what="returns" />}>{() => null}</QueryView></Card>;
  return <QueryView query={query} what="returns">{data => data.returns ? <ReturnsCard returns={data.returns} today={data.today} phone={phone} /> : null}</QueryView>;
}
/** Rates content is supplied by DashboardPage (5C's public component); this page owns the layout and reads. */
export default function Dashboard({ rates }: { rates?: ReactNode }) {
  const { isPhone } = useView(), s = useDashboardScope(), { can } = useAuth(), qc = useQueryClient();
  const query = useDashboard(s.queryFirm, s.fy), due = useDueNext(s.queryFirm, s.fy === s.fyChoices[0]);
  const today = query.data?.today.date ?? todayIST();
  const scope = s.firmId === "all" ? "All firms" : s.firms.find(f => f.id === s.firmId)?.short ?? "…";
  const past = s.fy !== s.fyChoices[0];
  const actions = <>{can("capture") ? <ButtonLink to={isPhone ? "/capture" : "/purchases/capture"} size={isPhone ? "lg" : "md"} icon={Camera}>{isPhone ? "Capture" : "Capture a bill"}</ButtonLink> : null}{can("bill.create") ? <ButtonLink to="/sales/new" variant="primary" size={isPhone ? "lg" : "md"} icon={Plus} title="New bill (Alt N)">New bill</ButtonLink> : null}</>;
  if (!s.loading && !s.error && !s.firms.length) return <Placeholder area="Dashboard" part={5} phoneSearch />;
  const content = (data: DashboardData) => {
    const returns = data.current ? <ReturnsPanel query={due} phone={isPhone} /> : data.returns_year ? <PastReturnsCard rows={data.returns_year} fy={data.fy} phone={isPhone} /> : null;
    return isPhone ? <><TodayCard data={data} scope={scope} allFirms={s.firmId === "all"} phone /><DuePanel query={due} phone />{rates}<MonthCard data={data} scope={scope} phone />{returns}<YearCard data={data} scope={scope} phone /></>
      : <><div className="dashboard-columns grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 items-start"><div className="flex flex-col gap-5 min-w-0"><TodayCard data={data} scope={scope} allFirms={s.firmId === "all"} /><MonthCard data={data} scope={scope} /><LatestChanges data={data} /></div><div className="flex flex-col gap-5 min-w-0"><DuePanel query={due} phone={false} />{rates}</div></div>{returns}<YearCard data={data} scope={scope} /></>;
  };
  return <Page className="dashboard" logo icon={LayoutDashboard} title="Today" context={`${dateLong(today)} · ${scope}${past ? ` · showing FY ${s.fy}` : ""}`} phoneSubtitle={`${dateShort(today)} · ${scope}${past ? ` · FY ${s.fy}` : ""}`} phoneSearch phoneActions={<PhoneTools />} actions={actions} actionBar={isPhone && (can("capture") || can("bill.create")) ? actions : null}>
    {isPhone ? <FirmChips firms={s.firms} value={s.firmId} onChange={s.setFirmId} /> : null}
    {s.error ? <LoadError what="firms" problem={s.problem!} retry={() => void qc.refetchQueries({ queryKey: ["firms"] })} /> : <QueryView key={`${s.queryFirm}:${s.fy}`} query={query} what="today's figures" skeleton={<DashSkeleton phone={isPhone} />}>{content}</QueryView>}
  </Page>;
}

import { useState, type ReactNode } from "react";
import { Building2, Check, ChevronDown, ChevronRight, History, KeyRound, Minus, MoreHorizontal, Search, ShieldCheck, UserCheck, UserPlus, UserRound, UserX } from "lucide-react";
import { useAddPerson, useChangePerson, usePeople, usePersonHistory, useSetPersonPassword, type Person } from "@/core/api/people";
import { problemOf, saveFailure, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { can, ROLES, type Action } from "@/core/auth/permissions";
import roleData from "@/core/auth/perms.json";
import type { Role } from "@/core/auth/role";
import { date, plural } from "@/core/format";
import { useFirms } from "@/core/scope";
import { useView } from "@/core/view";
import { Avatar, Badge, Banner, Button, ButtonLink, Card, cn, ConfirmDialog, Dialog, Disclosure, DL, EmptyState, FailNote, Field, IconButton, Input, Menu, Page, QueryView, SearchInput, Select, Table, Td, Th, Tr, useNewIds, type MenuItem } from "@/core/ui";
import { newPasswordValid, PasswordFields } from "./PasswordFields";

const ROLE_ORDER: Role[] = ["owner", "accountant", "staff", "viewer"];
const USUAL_FIRM_HINT = "Everyone can see all firms.";
const OWN_ROLE = "You can't change your own role. Another owner can.";
const CAPABILITIES: [Action, string][] = [
  ["view", "Look at bills, customers, products and reports"], ["bill.create", "Make sales bills"],
  ["bill.send", "Send bills on WhatsApp"], ["bill.edit", "Change a saved bill"], ["bill.cancel", "Cancel a bill"],
  ["bill.delete", "Delete a bill, restore deleted bills"], ["capture", "Photograph supplier bills"],
  ["purchase.create", "Add purchase bills"], ["purchase.edit", "Change purchase bills"],
  ["customer.edit", "Add and change customers"], ["customer.merge", "Merge or delete customers"],
  ["product.edit", "Add, change and delete products"], ["reports.export", "Download reports and exports"],
  ["gst.download", "Download GST return files"], ["gst.file", "Record GST returns as filed"],
  ["gst.lock", "Lock or relock a month"], ["gst.unlock", "Unlock a filed month"], ["backup.download", "Download a full backup"],
  ["backup.restore", "Restore from a backup"], ["audit.view", "See the audit log"],
  ["audit.undo", "Undo, revert and restore from the audit log"], ["firm.edit", "Add, change and delete firms"],
  ["settings.edit", "Change shop-wide settings"], ["users.manage", "Add people, change roles, stop or allow sign-in"],
];
const allowed = (role: Role, action: Action) => can(roleData.perms[role] as "*" | string[], action);
const firstName = (u: Person) => u.first_name || u.name.split(" ")[0];
const firmName = (u: Person) => u.usual_firm?.short || "The shop's default";
const when = (value: string | null) => value ? date(value.slice(0, 10)) : "Not signed in yet";
function RoleBadge({ role }: { role: Role }) { return <Badge tone={role === "owner" ? "brand" : role === "accountant" ? "file" : role === "staff" ? "sale" : "muted"}>{ROLES[role].label}</Badge>; }
function SaveError({ problem }: { problem: ApiProblem | null }) { return <FailNote error={problem ? saveFailure(problem) : null} />; }

export function RoleTable({ people }: { people?: Person[] }) {
  const { isPhone } = useView();
  const count = (r: Role) => people ? ` · ${plural(people.filter((u) => u.role === r && u.active).length, "person", "people")}` : "";
  const title = "What each role can do";
  const subtitle = `The same rules the app checks before every action; buttons someone can't use are switched off, with the reason. Roles don't depend on the firm: everyone can see all firms.`;
  return <Card title={title} subtitle={subtitle} pad={isPhone}>
    {isPhone ? <div className="flex flex-col divide-y divide-rule -my-1">{ROLE_ORDER.map((r) => <Disclosure key={r} title={`${ROLES[r].label}${count(r)}`} summary={ROLES[r].blurb}>
      <ul className="flex flex-col gap-1.5">{CAPABILITIES.map(([action, label]) => <li key={action} className={cn("flex items-start gap-2 text-sm", allowed(r, action) ? "text-fg" : "text-muted")}>
        {allowed(r, action) ? <Check size={16} className="text-sale mt-0.5 shrink-0" aria-hidden="true" /> : <Minus size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{label}<span className="sr-only">{allowed(r, action) ? ": yes" : ": no"}</span></span>
      </li>)}</ul>
    </Disclosure>)}</div> : <Table label={title} className="mt-2 table-fixed"><thead><tr><Th className="w-[37%] align-bottom">Action</Th>{ROLE_ORDER.map((r) => <Th key={r} className="!whitespace-normal normal-case tracking-normal font-normal align-bottom"><span className="flex items-center gap-2"><RoleBadge role={r} /><span className="text-xs text-muted">{count(r)}</span></span><span className="block text-xs text-muted mt-1.5 pr-2">{ROLES[r].blurb}</span></Th>)}</tr></thead>
      <tbody>{CAPABILITIES.map(([action, label]) => <Tr key={action}><Td className="py-2">{label}</Td>{ROLE_ORDER.map((r) => <Td key={r} className="py-2">{allowed(r, action) ? <Check size={18} className="text-sale" aria-label="Yes" /> : <Minus size={18} className="text-muted" aria-label="No" />}</Td>)}</Tr>)}</tbody></Table>}
  </Card>;
}
function HistoryRows({ person }: { person?: Person }) {
  const history = usePersonHistory(person?.id);
  return <QueryView query={history} what="recent changes">{(data) => data.results.length ? <ul className="mt-2">{data.results.map((e) => <li key={e.id} className="flex flex-col gap-0.5 px-5 py-3 border-t border-rule">
    <span className="font-medium">{[e.words.text, e.words.target, e.words.after].filter(Boolean).join(" ")}</span>
    {e.details ? <span className="text-sm text-fg2">{e.details}</span> : null}
    <span className="text-xs text-muted">{when(e.at)} · {e.by?.name || "Someone no longer here"}</span>
  </li>)}</ul> : <p className="px-5 py-4 text-muted">No changes to people yet.</p>}</QueryView>;
}
function PeopleFrame({ children }: { children: ReactNode }) {
  return useView().isPhone ? <div className="flex flex-col gap-4">{children}</div> : <Card pad={false}>{children}</Card>;
}
function RecentChanges() { return <Card title="Recent changes to people" subtitle="Every addition, role change and sign-in change is in the Audit log" pad={false} actions={<ButtonLink size="sm" variant="ghost" icon={History} to="/audit?kind=admin">Audit log</ButtonLink>}><HistoryRows /></Card>; }

export default function Users() {
  const auth = useAuth();
  if (!auth.can("users.manage")) return <Page icon={ShieldCheck} title="Users and roles" back="/more" context={`You're signed in as ${auth.me?.fullName} · ${auth.me?.roleLabel}`}>
    <Card title="Only the owner manages users"><p className="text-fg2">{auth.whyNot("users.manage", "add people or change roles")} Below is what each role can do.</p><ButtonLink to="/profile" icon={UserRound} className="mt-3">Your profile and password</ButtonLink></Card><RoleTable />
  </Page>;
  return <Manage />;
}
function RolePicker({ person, onPick, full = false }: { person: Person; onPick: (role: Role) => void; full?: boolean }) {
  return <Menu title={`Role for ${person.name}`} width={320} items={ROLE_ORDER.map((r) => ({ label: ROLES[r].label, checked: r === person.role, hint: `${r === person.role ? "Now · " : ""}${ROLES[r].blurb}`, onSelect: () => onPick(r) }))}
    trigger={(props) => <Button {...props} id={full ? "us-role" : undefined} iconRight={ChevronDown} full={full} disabled={person.you} title={person.you ? OWN_ROLE : undefined} aria-label={`Role for ${person.name}: ${ROLES[person.role].label}${person.you ? "" : ". Change"}`} className={full ? "justify-between" : "w-[190px] justify-between"}>{person.needs_role_choice ? "Choose a role" : ROLES[person.role].label}</Button>} />;
}
type Change = { person: Person; kind: "role"; role: Role } | { person: Person; kind: "stop" | "allow" };
function Manage() {
  const { isPhone } = useView();
  const query = usePeople(useAuth().can("users.manage"));
  const change = useChangePerson();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Change | null>(null);
  const [firmFor, setFirmFor] = useState<Person | null>(null);
  const [passwordFor, setPasswordFor] = useState<Person | null>(null);
  const [historyFor, setHistoryFor] = useState<Person | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const people = query.data?.results ?? [];
  const rowKey = (u: Person) => `${u.id}:${u.role}:${u.placed}:${u.usual_firm?.id ?? ""}:${u.active}:${u.must_change_password}`;
  const fresh = useNewIds(people.map(rowKey));
  const selected = people.find((u) => u.id === sheet);
  const clear = () => { setSearch(""); setRole("all"); setStatus("all"); };
  const askRole = (person: Person, next: Role) => { if (next !== person.role || person.needs_role_choice) { setSheet(null); setProblem(null); setPending({ person, kind: "role", role: next }); } };
  const askChange = (person: Person, kind: "stop" | "allow") => { setSheet(null); setProblem(null); setPending({ person, kind }); };
  const openFirm = (person: Person) => { setSheet(null); setFirmFor(person); };
  const openPassword = (person: Person) => { setSheet(null); setPasswordFor(person); };
  const openHistory = (person: Person) => { setSheet(null); setHistoryFor(person); };
  const menuItems = (u: Person): MenuItem[] => [
    { label: "Change usual firm…", icon: Building2, hint: `Usually works for ${firmName(u)}`, disabled: !u.active, onSelect: () => openFirm(u) },
    u.you ? { label: "Change your password", icon: KeyRound, hint: "On your profile", to: "/profile" } : { label: "Set a new password…", icon: KeyRound, hint: "You give it to them; they choose their own next time", disabled: !u.active, onSelect: () => openPassword(u) },
    { label: "Recent changes…", icon: History, onSelect: () => openHistory(u) }, { divider: true },
    u.active ? { label: u.you ? "Stop yourself signing in" : `Stop ${firstName(u)} signing in…`, icon: UserX, tone: "danger", disabled: u.you, hint: u.you ? "You can't stop yourself. Another owner can." : "Their bills and history stay", onSelect: () => askChange(u, "stop") }
      : { label: `Let ${firstName(u)} back in…`, icon: UserCheck, hint: `As ${ROLES[u.role].label}`, onSelect: () => askChange(u, "allow") },
  ];
  const save = async () => {
    if (!pending || change.isPending) return;
    try {
      await change.mutateAsync(pending.kind === "role" ? { id: pending.person.id, action: "role", body: { role: pending.role } } : { id: pending.person.id, action: pending.kind });
      if (isPhone && pending.kind === "role") setSheet(pending.person.id);
      setPending(null); setProblem(null);
    } catch (error) { setProblem(problemOf(error)); }
  };
  const diff = pending?.kind === "role" ? {
    gains: CAPABILITIES.filter(([action]) => !allowed(pending.person.role, action) && allowed(pending.role, action)).map(([, label]) => label.toLowerCase()),
    losses: CAPABILITIES.filter(([action]) => allowed(pending.person.role, action) && !allowed(pending.role, action)).map(([, label]) => label.toLowerCase()),
  } : { gains: [], losses: [] };
  const row = (u: Person) => <button key={u.id} type="button" onClick={() => setSheet(u.id)} className={cn("flex items-center gap-3 w-full text-left px-4 py-3 min-h-16 border-t border-rule first:border-t-0 hover:bg-raised/60", fresh.has(rowKey(u)) && "anim-flash")}>
    <Avatar name={u.name} size={36} tone={u.you ? "brand" : "muted"} /><span className="flex-1 min-w-0"><span className="block font-medium line-clamp-2 break-words">{u.name}{u.you ? " · you" : ""}</span><span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1"><RoleBadge role={u.role} /><span className="text-sm text-muted tnum">{!u.active ? `Stopped ${when(u.stopped_at)}` : u.you ? "Signed in now" : when(u.last_active)}{u.active && u.must_change_password ? " · new password" : ""}</span></span>{u.needs_role_choice ? <span className="block text-sm text-amber">Counter staff · not placed yet</span> : null}</span><ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
  </button>;
  const table = (list: Person[], label: string) => isPhone ? <Card pad={false}>{list.map(row)}</Card> : <Table label={label} className="mt-1"><thead><tr><Th>Person</Th><Th>Role</Th><Th>Usually works for</Th><Th>Last active</Th><Th align="right"><span className="sr-only">Actions</span></Th></tr></thead><tbody>{list.map((u) => <Tr key={u.id} className={fresh.has(rowKey(u)) ? "anim-flash" : undefined}>
    <Td><span className="flex items-center gap-3"><Avatar name={u.name} size={36} tone={u.you ? "brand" : "muted"} /><span className="min-w-0"><span className="flex items-center gap-2"><span className="font-medium">{u.name}</span>{u.you ? <Badge tone="brand">You</Badge> : null}{u.must_change_password && u.active ? <Badge title="They'll choose their own password when they next sign in">New password</Badge> : null}</span><span className="block text-xs text-muted">@{u.username}{u.email ? ` · ${u.email}` : ""}</span></span></span></Td>
    <Td><div className="flex flex-col items-start gap-1"><RolePicker person={u} onPick={(r) => askRole(u, r)} />{u.you ? <span className="text-xs text-muted">{OWN_ROLE}</span> : null}{u.needs_role_choice ? <span className="text-sm text-amber">Counter staff · not placed yet</span> : null}{!u.active ? <span className="text-xs text-muted">Stopped {when(u.stopped_at)}</span> : null}</div></Td>
    <Td className="text-fg2">{firmName(u)}</Td><Td className="text-fg2">{u.you ? "Now" : when(u.last_active)}</Td><Td align="right"><Menu title={u.name} width={300} items={menuItems(u)} trigger={(props) => <IconButton {...props} label={`More for ${u.name}`} icon={MoreHorizontal} />} /></Td>
  </Tr>)}</tbody></Table>;
  const addButton = <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>Add a person</Button>;
  return <Page icon={ShieldCheck} title="Users and roles" back="/more" context={query.data ? `${plural(people.filter((u) => u.active).length, "person", "people")} can sign in · only the owner sees this page` : "People and their roles"} phoneSubtitle={query.data ? `${plural(people.filter((u) => u.active).length, "person", "people")} can sign in` : "People and their roles"} actions={isPhone ? undefined : addButton} actionBar={isPhone ? addButton : undefined}>
    <QueryView query={query} what="people">{(data) => {
      const q = search.trim().toLowerCase();
      const matched = data.results.filter((u) => (!q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q)) && (role === "all" || u.role === role));
      const active = matched.filter((u) => u.active && status !== "inactive");
      const inactive = matched.filter((u) => !u.active && status !== "active");
      return <PeopleFrame><div className={cn("flex gap-3", isPhone ? "flex-col" : "flex-wrap items-center px-5 pt-4 pb-3")}>
        <SearchInput value={search} onChange={setSearch} placeholder="Name, username or email" label="Search people" className={isPhone ? "" : "w-[280px]"} data-page-search />
        <div className={cn("flex gap-2", isPhone && "grid grid-cols-2")}><Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "all", label: "Every role" }, ...ROLE_ORDER.map((r) => ({ value: r, label: ROLES[r].label }))]} /><Select aria-label="Filter by sign-in" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "all", label: "Everyone" }, { value: "active", label: "Can sign in" }, { value: "inactive", label: "Can't sign in" }]} /></div>
        {q || role !== "all" || status !== "all" ? <Button variant="ghost" size="sm" onClick={clear}>Clear</Button> : null}
      </div>{data.results.some((u) => u.needs_role_choice) ? <Banner tone="amber" title="Choose a role for people not placed yet" className="mx-4 mb-3">Choose Counter staff to keep that role, or pick another role from the table below.</Banner> : null}
        {active.length ? <>{!isPhone ? <p className="px-5 pt-3 text-sm font-semibold">Can sign in · {active.length}</p> : null}{table(active, "People who can sign in")}</> : null}
        {inactive.length ? <section className={isPhone ? "flex flex-col gap-2" : "border-t border-line mt-1"}><h2 className={isPhone ? "caps px-1" : "px-5 pt-3 text-sm font-semibold"}>Can't sign in · {inactive.length}</h2><p className="px-5 text-sm text-muted">Their bills and history stay. Let them back in to give them their access again.</p>{table(inactive, "People who can't sign in")}</section> : null}
        {!active.length && !inactive.length ? <EmptyState icon={Search} title="Nobody matches" actions={<Button onClick={clear}>Show everyone</Button>}>Search looks at names, usernames and emails.</EmptyState> : null}
        <p className={isPhone ? "text-sm text-muted px-1" : "px-5 py-3 border-t border-rule text-sm text-muted"}>“Usually works for” only sets where a person's new bills and lists start. {USUAL_FIRM_HINT}</p>
      </PeopleFrame>;
    }}</QueryView>
    <RoleTable people={query.data?.results} /><RecentChanges />
    {adding ? <AddPerson people={people} onClose={() => setAdding(false)} /> : null}
    {firmFor ? <FirmsDialog person={firmFor} onClose={() => setFirmFor(null)} /> : null}
    {passwordFor ? <PasswordDialog person={passwordFor} onClose={() => setPasswordFor(null)} /> : null}
    {historyFor ? <Dialog open onClose={() => setHistoryFor(null)} title={`Recent changes to ${historyFor.name}`}><HistoryRows person={historyFor} /></Dialog> : null}
    <Dialog open={Boolean(selected)} onClose={() => setSheet(null)} title={selected?.name || ""} description={selected ? [`@${selected.username}`, selected.email].filter(Boolean).join(" · ") : ""}>
      {selected ? <div className="flex flex-col gap-4"><div className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg2">Role</span><RolePicker person={selected} full onPick={(r) => askRole(selected, r)} /><p className="text-sm text-muted">{selected.you ? OWN_ROLE : ROLES[selected.role].blurb}</p></div><DL rows={[["Usually works for", firmName(selected)], ["Joined", date(selected.joined)], ["Last active", selected.you ? "Now" : when(selected.last_active)], ["Sign-in", selected.active ? "Can sign in" : "Can't sign in"]]} /><div className="flex flex-col gap-2">
        {selected.active ? <Button icon={Building2} onClick={() => openFirm(selected)}>Change usual firm</Button> : null}
        {selected.you ? <ButtonLink icon={KeyRound} to="/profile">Change your password</ButtonLink> : selected.active ? <Button icon={KeyRound} onClick={() => openPassword(selected)}>Set a new password</Button> : null}
        <Button icon={History} onClick={() => openHistory(selected)}>Recent changes</Button>
        {selected.active ? <Button variant="danger-outline" icon={UserX} disabled={selected.you} onClick={() => askChange(selected, "stop")}>{selected.you ? "You can't stop yourself" : `Stop ${firstName(selected)} signing in`}</Button> : <Button variant="primary" icon={UserCheck} onClick={() => askChange(selected, "allow")}>Let {firstName(selected)} back in</Button>}
      </div></div> : null}
    </Dialog>
    <ConfirmDialog open={Boolean(pending)} onClose={() => { if (isPhone && pending?.kind === "role") setSheet(pending.person.id); setPending(null); setProblem(null); }} onConfirm={() => void save()} busy={change.isPending} title={!pending ? "" : pending.kind === "role" ? `${pending.person.name}: ${ROLES[pending.person.role].label} → ${ROLES[pending.role].label}` : pending.kind === "stop" ? `Stop ${pending.person.name} signing in?` : `Let ${pending.person.name} back in?`} confirmLabel={pending?.kind === "role" ? "Change role" : pending?.kind === "stop" ? `Stop ${firstName(pending.person)} signing in` : "Let them back in"} tone={pending?.kind === "stop" ? "danger" : "primary"} ack={pending?.kind === "role" && pending.role === "owner" ? `I understand ${firstName(pending.person)} will be able to delete bills, restore backups and manage people.` : undefined} record={pending ? [["Person", `${pending.person.name} (@${pending.person.username})`], ["Role now", ROLES[pending.person.role].label], ...(pending.kind === "role" ? [["New role", ROLES[pending.role].label] as const] : [])] : undefined} extra={<SaveError problem={problem} />}>
      {pending?.kind === "role" ? <>{diff.gains.length ? <p><span className="font-medium text-fg">Will be able to:</span> {diff.gains.join("; ")}.</p> : null}{diff.losses.length ? <p><span className="font-medium text-fg">Will no longer:</span> {diff.losses.join("; ")}.</p> : null}<p>It applies the next time {firstName(pending.person)} opens the app, and is recorded in the Audit log.</p></> : pending?.kind === "stop" ? <p>They're signed out everywhere and can't sign in. Nothing they made is deleted: their bills and history stay, with their name. They move to “Can't sign in”, where you can let them back in.</p> : <p>They get the same role as before, and their old password works. Change the role first if it should be different.</p>}
    </ConfirmDialog>
  </Page>;
}

function UsualFirmField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { firms, loading, error, problem } = useFirms();
  return <Field label="Usually works for" htmlFor="person-firm" error={error ? problem?.message : undefined} hint={`Their new bills start with this firm and their lists open on it. ${USUAL_FIRM_HINT}`}><Select id="person-firm" value={value} onChange={(e) => onChange(e.target.value)} disabled={loading || error} options={[{ value: "", label: "The shop's default" }, ...firms.map((f) => ({ value: String(f.id), label: f.name }))]} /></Field>;
}
function FirmsDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [value, setValue] = useState(String(person.usual_firm?.id ?? ""));
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const mutation = useChangePerson();
  const save = async () => { if (mutation.isPending) return; try { await mutation.mutateAsync({ id: person.id, action: "usual-firm", body: { business: value ? Number(value) : null } }); onClose(); } catch (error) { setProblem(problemOf(error)); } };
  return <Dialog open onClose={() => { if (!mutation.isPending) onClose(); }} title={`${person.name} usually works for`} size="sm" description="Their new bills start with this firm and their lists open on it. They can switch firms any time." footer={<><Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" disabled={value === String(person.usual_firm?.id ?? "")} loading={mutation.isPending} onClick={() => void save()}>Save</Button></>}><div className="flex flex-col gap-3"><UsualFirmField value={value} onChange={setValue} /><SaveError problem={problem} /></div></Dialog>;
}
function PasswordDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [password, setPassword] = useState(""); const [again, setAgain] = useState(""); const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null); const mutation = useSetPersonPassword();
  const save = async () => { setTried(true); if (!newPasswordValid(password, again, person) || mutation.isPending) return; try { await mutation.mutateAsync({ id: person.id, password }); setPassword(""); setAgain(""); onClose(); } catch (error) { setProblem(problemOf(error)); } };
  return <Dialog open onClose={() => { if (!mutation.isPending) onClose(); }} title={`New password for ${person.name}`} size="sm" description="Their old password stops working and they're signed out everywhere. Give them this one in person or by phone; they choose their own when they next sign in." footer={<><Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" icon={KeyRound} onClick={() => void save()} loading={mutation.isPending}>Set password</Button></>}><div className="flex flex-col gap-3"><PasswordFields id="pw-set" value={password} onChange={setPassword} again={again} onAgain={setAgain} identity={person} tried={tried} error={problem?.fields?.password} /><SaveError problem={problem} /></div></Dialog>;
}
function AddPerson({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const { isPhone } = useView(); const mutation = useAddPerson();
  const [form, setForm] = useState({ first_name: "", last_name: "", username: "", email: "", role: "staff" as Role, usual_firm: "", password: "", again: "" });
  const [touched, setTouched] = useState(false); const [tried, setTried] = useState(false); const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = (key: keyof typeof form, value: string) => { setForm((old) => ({ ...old, [key]: value })); setProblem(null); };
  const suggest = (first: string, last: string) => { const base = `${first}${last ? `_${last[0]}` : ""}`.toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!base) return ""; let name = base; let i = 2; while (people.some((p) => p.username.toLowerCase() === name)) name = `${base}${i++}`; return name; };
  const errs: Record<string, string> = {};
  if (!form.first_name.trim()) errs.first_name = "Enter their first name, as it should show in the Audit log.";
  if (!form.username) errs.username = "Pick a username they'll sign in with.";
  else if (!/^[a-z0-9_.]{3,20}$/.test(form.username)) errs.username = "Use 3 to 20 lowercase letters, digits, dots or underscores.";
  else { const taken = people.find((p) => p.username.toLowerCase() === form.username.toLowerCase()); if (taken) errs.username = `@${form.username} is taken by ${taken.name}. Try another.`; }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "That email looks incomplete. It should look like name@example.com.";
  const error = (key: string) => problem?.fields?.[key] || (tried || (key === "username" && touched) ? errs[key] : undefined);
  const save = async () => {
    setTried(true); if (mutation.isPending) return;
    if (Object.keys(errs).length || !newPasswordValid(form.password, form.again, form)) { document.getElementById(errs.first_name ? "ap-first_name" : errs.username ? "ap-username" : errs.email ? "ap-email" : "ap-pw-password")?.focus(); return; }
    try { await mutation.mutateAsync({ first_name: form.first_name.trim(), last_name: form.last_name.trim(), username: form.username, email: form.email.trim(), role: form.role, usual_firm: form.usual_firm ? Number(form.usual_firm) : null, password: form.password }); setForm((old) => ({ ...old, password: "", again: "" })); onClose(); } catch (e) { setProblem(problemOf(e)); }
  };
  return <Dialog open onClose={() => { if (!mutation.isPending) onClose(); }} title="Add a person" size="md" description="You set their password and give it to them; they choose their own when they next sign in. No email is sent." footer={<><Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" icon={UserPlus} onClick={() => void save()} loading={mutation.isPending}>{`Add${form.first_name.trim() ? ` ${form.first_name.trim()}` : ""}`}</Button></>}>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="flex flex-col gap-4"><SaveError problem={problem?.fields ? null : problem} />
      <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2")}>
        {(["first_name", "last_name", "username", "email"] as const).map((key) => <Field key={key} label={{ first_name: "First name", last_name: "Last name", username: "Username", email: "Email" }[key]} htmlFor={`ap-${key}`} required={key === "first_name" || key === "username"} error={error(key)} hint={key === "username" ? "They sign in with it" : key === "last_name" || key === "email" ? "Optional" : undefined}>
          <Input id={`ap-${key}`} value={form[key]} autoComplete="off" type={key === "email" ? "email" : "text"} prefix={key === "username" ? "@" : undefined} autoCapitalize={key === "username" ? "none" : undefined} spellCheck={key === "username" ? false : undefined} invalid={Boolean(error(key))} onChange={(e) => {
            const value = e.target.value;
            if (key === "first_name" || key === "last_name") { setProblem(null); setForm((old) => ({ ...old, [key]: value, username: touched ? old.username : suggest(key === "first_name" ? value : old.first_name, key === "last_name" ? value : old.last_name) })); }
            else { if (key === "username") setTouched(true); set(key, key === "username" ? value.toLowerCase().replace(/\s/g, "") : value.trim()); }
          }} />
        </Field>)}
      </div>
      <fieldset><legend id="ap-role-label" className="text-sm font-medium text-fg2 mb-1.5">Role</legend><div role="radiogroup" aria-labelledby="ap-role-label" className={cn("grid gap-2", isPhone ? "grid-cols-1" : "grid-cols-2")}>{ROLE_ORDER.map((r) => <label key={r} className={cn("flex gap-2 text-left rounded-ctl border px-3.5 py-2.5 min-h-11 transition-colors duration-150", form.role === r ? "bg-brand-sel border-brand" : "bg-field border-ctl-line hover:border-muted")}><input type="radio" name="new-person-role" value={r} checked={form.role === r} onChange={() => set("role", r)} className="accent-brand mt-1 shrink-0" /><span><span className={cn("block font-medium", form.role === r && "text-brand")}>{ROLES[r].label}</span><span className="block text-sm text-muted">{ROLES[r].blurb}</span></span></label>)}</div></fieldset>
      <UsualFirmField value={form.usual_firm} onChange={(value) => set("usual_firm", value)} />
      {problem?.fields?.role || problem?.fields?.usual_firm ? <p role="alert" className="text-neg">{problem.fields.role || problem.fields.usual_firm}</p> : null}
      <div className="border-t border-rule pt-4"><PasswordFields id="ap-pw" value={form.password} onChange={(value) => set("password", value)} again={form.again} onAgain={(value) => set("again", value)} identity={form} tried={tried} error={problem?.fields?.password} /></div>
      <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
    </form>
  </Dialog>;
}

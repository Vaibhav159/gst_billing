import { fireEvent, screen, within } from "@testing-library/react";
import { wireDue } from "@/core/dashboard/fixtures";
import { toDueNext } from "@/core/dashboard/wire";
import type { DueItem, DueKind } from "@/core/dashboard/types";
import { renderApp } from "@/test/render";
import { chipWhen, dueLink, dueTone } from "./model";
import { Due } from "./Due";
import { DueNextCard } from "./DueNextCard";
const item = (kind: DueKind): DueItem => ({ ...toDueNext(wireDue()).items[0], kind, draft_id: "a-b", from: "2026-04-01", to: "2026-10-08" });
test.each([
  ["blocker", "/gst?firm=3&month=2026-09&fix=1"], ["file_gstr1", "/gst?firm=3&month=2026-09"], ["pay_3b", "/gst?firm=3&month=2026-09"],
  ["gaps", "/sales/paper?firm=3&month=2026-09"], ["open_blocker", "/gst?firm=3&month=2026-09"], ["credit", "/gst?tab=credit&firm=3"],
  ["itax", "/sales?status=itax&from=2026-04-01&to=2026-10-08"], ["captures", "/purchases/inbox"], ["unsent", "/sales?when=today&status=unsent"],
  ["drafts", "/sales/new?draft=a-b"], ["review", "/purchases?status=check"],
] as [DueKind, string][])('routes %s using the contract', (kind, href) => expect(dueLink(item(kind))).toBe(href));
test.each([
  ["2026-10-06", "2 days late", "neg"], ["2026-10-07", "1 day late", "neg"], ["2026-10-08", "today", "neg"],
  ["2026-10-09", "tomorrow", "neg"], ["2026-10-11", "3 days", "neg"], ["2026-10-12", "4 days", "brand"],
  ["2026-10-23", "15 days", "brand"], ["2026-10-24", "16 days", "muted"],
])("chip boundaries at %s use the server day", (due, words, tone) => {
  expect(chipWhen("2026-10-08", due)).toBe(words); expect(dueTone({ ...item("blocker"), due }, "2026-10-08")).toBe(tone);
});
test("IST month/year boundaries and undated tones", () => {
  expect(chipWhen("2026-12-31", "2027-01-01")).toBe("tomorrow");
  expect(chipWhen("2026-03-31", "2026-04-01")).toBe("tomorrow");
  for (const kind of ["captures", "unsent", "review", "itax"] as const) expect(dueTone({ ...item(kind), due: null }, "2026-10-08")).toBe("brand");
  expect(dueTone({ ...item("drafts"), due: null }, "2026-10-08")).toBe("muted");
});
test("returns Due line uses tomorrow and its own seven-day amber threshold", () => {
  renderApp(<Due today="2026-10-08" iso="2026-10-09" label="GSTR-1" />);
  expect(screen.getByText("tomorrow")).toHaveClass("text-neg"); expect(screen.getByText(/GSTR-1 due 09 Oct 2026/)).toBeVisible();
});
test.each([false, true])("Due next limits and expands accessibly (phone %s)", phone => {
  const data = toDueNext(wireDue()); data.items = Array.from({ length: 8 }, (_, i) => ({ ...item("drafts"), due: null, title: `Unfinished bill ${i}`, draft_id: String(i) }));
  renderApp(<DueNextCard data={data} phone={phone} />);
  const card = screen.getByRole("region", { name: "Due next" });
  expect(within(card).getAllByRole("link")).toHaveLength(phone ? 4 : 6);
  const more = within(card).getByRole("button", { name: phone ? "Show 4 more" : "Show 2 more" }); expect(more).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(more); expect(within(card).getAllByRole("link")).toHaveLength(8); expect(more).toHaveAttribute("aria-expanded", "true"); fireEvent.click(more);
  expect(within(card).getAllByRole("link")).toHaveLength(phone ? 4 : 6);
});
test.each([true, false])("empty due words follow ability (maker %s)", maker => {
  renderApp(<DueNextCard data={{ today: "2026-10-08", items: [], returns: null }} />, { me: { permissions: maker ? ["bill.create"] : ["view"], role: maker ? "staff" : "viewer" } });
  expect(screen.getByText(maker ? "Nothing due in the next 15 days" : "Nothing for you to do here")).toBeVisible();
  if (!maker) expect(screen.getByText("The owner and the accountant look after filing and the day's loose ends. Figures below are for reading.")).toBeVisible();
});

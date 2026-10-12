import { render, screen, within } from "@testing-library/react";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { BillDocument } from "./BillDocument";
import { copyPages, printBill } from "./model";
import { Paper } from "./Paper";
import { expand, flat, nodes, raw, type PdfNode } from "./testing";

// Deliberately different dimensions prove both renderers take their measurements from one source.
// The existing Paper and BillDocument page-plan tests pin the production values and appearance.
vi.mock("./layout", () => ({ LAYOUT: {
  cols: [28, 0, 52, 64, 60, 32, 84], infoWidth: 250, titleSide: 90, bankLabel: 88,
  padding: { pageVertical: 15, pageHorizontal: 21, cell: 4, block: 6, noteLeft: 9 },
} }));

const pt = (n: number) => `${n * 4 / 3}px`;

test("the screen and PDF use the same columns, boxes, QR sides, bank labels and padding", () => {
  const b = printBill(toBillDetail(wireDetail()), { showBank: true });
  const copies = copyPages("original");
  render(<Paper b={b} copy={copies[0]} page={b.pages[0]} />);
  const paper = screen.getByRole("document");
  expect(paper).toHaveStyle({ padding: `${pt(15)} ${pt(21)}` });
  const goods = within(screen.getByRole("table", { name: "Goods" })).getAllByRole("row")[0];
  expect(goods).toHaveStyle({ gridTemplateColumns: [28, 0, 52, 64, 60, 32, 84].map((n) => n ? pt(n) : "minmax(0,1fr)").join(" ") });
  expect(within(goods).getByText("Quantity")).toHaveStyle({ padding: pt(4) });
  const meta = screen.getByText("Invoice No.").parentElement!;
  expect(meta).toHaveStyle({ padding: pt(4) });
  expect(meta.parentElement!.parentElement!).toHaveStyle({ gridTemplateColumns: `minmax(0,1fr) ${pt(250)}` });
  expect(screen.getByRole("heading", { level: 2 }).parentElement!).toHaveStyle({ gridTemplateColumns: `${pt(90)} minmax(0,1fr) ${pt(90)}` });
  expect(screen.getByText("Bank Name").parentElement!).toHaveStyle({ gridTemplateColumns: `${pt(88)} minmax(0,1fr)` });
  expect(screen.getAllByText("KIRAN GOLD HOUSE")[0].parentElement!.parentElement!).toHaveStyle({ padding: pt(6) });
  expect(screen.getByText("Peacock design").parentElement!).toHaveStyle({ paddingLeft: pt(9) });
  expect(screen.getByText("This is a Computer Generated Invoice")).toHaveStyle({ paddingTop: pt(4), paddingBottom: pt(4) });

  const [page] = nodes(expand(<BillDocument bills={[b]} copies={copies} title="t" />)[0], "PAGE");
  expect(flat(page.props.style)).toMatchObject({ paddingTop: 15, paddingBottom: 15, paddingHorizontal: 21 });
  const views = nodes(page, "VIEW");
  const heading = views.find((v) => v.children.length === 7 && raw(v.children[0]) === "Sl No.")!;
  expect(heading.children.map((c) => flat((c as PdfNode).props.style).width ?? 0)).toEqual([28, 0, 52, 64, 60, 32, 84]);
  expect(heading.children.map((c) => flat((c as PdfNode).props.style).padding)).toEqual(Array(7).fill(4));
  expect(views.filter((v) => flat(v.props.style).width === 250)).toHaveLength(2); // metadata and bank/signature
  expect(views.filter((v) => flat(v.props.style).width === 90)).toHaveLength(2); // title spacer and QR
  const label = nodes(page, "TEXT").find((t) => raw(t) === "Bank Name")!;
  expect(flat(label.props.style)).toMatchObject({ width: 88 });
  const firm = views.find((v) => v.children.some((c) => raw(c) === "KIRAN GOLD HOUSE"))!;
  expect(flat(firm.props.style)).toMatchObject({ padding: 6 });
  const note = nodes(page, "TEXT").find((t) => raw(t) === "Peacock design")!;
  expect(flat(note.props.style)).toMatchObject({ paddingLeft: 9 });
  const foot = nodes(page, "TEXT").find((t) => raw(t) === "This is a Computer Generated Invoice")!;
  expect(flat(foot.props.style)).toMatchObject({ paddingVertical: 4 });
});

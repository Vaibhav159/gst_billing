import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";
import { FIRM, salesServer, wirePage, wireRow } from "@/core/sales/fixtures";
import { renderApp } from "@/test/render";
import { checkQr, QrCheck } from "./QrCheck";
const FIRMS = [{ id: FIRM.id, name: FIRM.name, short: "Kiran", gstin: FIRM.gst_number, state: FIRM.state_name }];
const CODE = "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21";
afterEach(() => { cleanup(); vi.useRealTimers(); });
test("both exact and whitespace-fallback QR reads omit summaries", async () => {
  const { calls } = salesServer([["GET", "sales/", ({ params }) => wirePage(params.number ? [] : [wireRow({ invoice_number: "KGH /2026-27/31" })])]]);
  expect(await checkQr(CODE, FIRMS)).toMatchObject({ kind: "match" });
  const reads = calls.filter((c) => c.url === "sales/");
  expect(reads).toHaveLength(2);
  expect(reads.map((c) => c.params.summary)).toEqual([0, 0]);
});
test("the QR answer updates one status node present before the first answer", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  salesServer([["GET", "sales/", () => wirePage([wireRow()])]]);
  function Check() { const input = useRef<HTMLInputElement>(null); return <QrCheck input={input} go={() => {}} />; }
  renderApp(<Check />);
  const status = screen.getByRole("status");
  expect(status).toBeEmptyDOMElement();
  const input = screen.getByLabelText("Or type or paste what it says");
  fireEvent.change(input, { target: { value: CODE } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  await screen.findByText("Matches KGH/2026-27/31");
  expect(screen.getAllByRole("status")).toEqual([status]);
  expect(status).toHaveTextContent("Matches KGH/2026-27/31");
  act(() => vi.setSystemTime(Date.now() + 6000));
  fireEvent.change(input, { target: { value: CODE.replace("87083.21", "100.00") } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  await screen.findByText("KGH/2026-27/31 doesn't match the QR code");
  expect(screen.getAllByRole("status")).toEqual([status]);
});

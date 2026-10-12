// What the statement page does with its PDF: makes it ahead, prints it in a new tab and shares it. A stand-in maker
// answers when each test says (the real PDF is statementPdf.test.tsx's).
import { act, renderHook } from "@testing-library/react";
import { printPdf, sharePdf, useStatementPdf } from "./statementFiles";
import { makeStatementPdf, type StatementPdfData } from "./statementPdf";

vi.mock("./statementPdf", () => ({ makeStatementPdf: vi.fn() }));

/** A promise each test settles itself. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
// the hook only hands data to the maker, so a period's label stands in for the whole statement
const period = (label: string, bills = 1) => ({ periodLabel: label, statement: { bills: Array.from({ length: bills }, (_, id) => ({ id })) } }) as StatementPdfData;
const pdfOf = (what: string) => new Blob([`%PDF-1.3 ${what}`], { type: "application/pdf" });
const NAME = "Anil-Gupta_statement_FY-2026-27.pdf";
const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

beforeEach(() => {
  vi.mocked(makeStatementPdf).mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:statement"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(URL, objectUrls);
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

test("the PDF is made as soon as there's a statement; a period just picked never gets the last one's file", async () => {
  const sept = later<Blob>();
  const oct = later<Blob>();
  vi.mocked(makeStatementPdf).mockReturnValueOnce(sept.promise).mockReturnValueOnce(oct.promise);
  const SEPT = period("September 2026");
  const OCT = period("October 2026");
  const septPdf = pdfOf("September");
  const octPdf = pdfOf("October");
  const { result, rerender } = renderHook(({ data }) => useStatementPdf(data), { initialProps: { data: null as StatementPdfData | null } });
  expect(result.current).toMatchObject({ blob: null, failed: false });
  expect(makeStatementPdf).not.toHaveBeenCalled();

  rerender({ data: SEPT });
  expect(makeStatementPdf).toHaveBeenLastCalledWith(SEPT);
  expect(result.current).toMatchObject({ blob: null, failed: false });
  await act(async () => { sept.resolve(septPdf); });
  expect(result.current.blob).toBe(septPdf);
  expect(result.current.failed).toBe(false);

  rerender({ data: OCT });
  expect(makeStatementPdf).toHaveBeenLastCalledWith(OCT);
  expect(result.current).toMatchObject({ blob: null, failed: false });
  await act(async () => { oct.resolve(octPdf); });
  expect(result.current.blob).toBe(octPdf);
});

test("a PDF that comes after its period was left is dropped, and one that couldn't be made says so", async () => {
  const sept = later<Blob>();
  const oct = later<Blob>();
  vi.mocked(makeStatementPdf).mockReturnValueOnce(sept.promise).mockReturnValueOnce(oct.promise);
  const OCT = period("October 2026");
  const octPdf = pdfOf("October");
  const { result, rerender } = renderHook(({ data }) => useStatementPdf(data), { initialProps: { data: period("September 2026") } });
  rerender({ data: OCT });
  await act(async () => { oct.resolve(octPdf); });
  await act(async () => { sept.resolve(pdfOf("September")); });
  expect(result.current.blob).toBe(octPdf);
  expect(result.current.failed).toBe(false);

  vi.mocked(makeStatementPdf).mockRejectedValueOnce(new Error("the font didn't load"));
  rerender({ data: period("FY 2026-27") });
  await act(async () => {});
  expect(result.current).toMatchObject({ blob: null, failed: true });
});

test("Print opens the PDF in a new tab and prints it once it has loaded; a tab the browser stopped is false", () => {
  vi.useFakeTimers();
  const blob = pdfOf("FY");
  const open = vi.spyOn(window, "open").mockReturnValueOnce(null);
  expect(printPdf(blob)).toBe(false);
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(open).toHaveBeenLastCalledWith("blob:statement", "_blank");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:statement");

  vi.mocked(URL.revokeObjectURL).mockClear();
  let loaded = () => {};
  const tab = { print: vi.fn(), addEventListener: vi.fn((type: string, fn: () => void) => { if (type === "load") loaded = fn; }) };
  open.mockReturnValueOnce(tab as unknown as Window);
  expect(printPdf(blob)).toBe(true);
  expect(tab.print).not.toHaveBeenCalled();
  loaded();
  expect(tab.print).toHaveBeenCalledTimes(1);
  // the tab reads the file for a while; then its address is let go
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:statement");

  // a viewer that refuses print() has its own Print button
  tab.print.mockImplementationOnce(() => { throw new Error("not allowed"); });
  open.mockReturnValueOnce(tab as unknown as Window);
  expect(printPdf(blob)).toBe(true);
  expect(loaded).not.toThrow();
});

test("Share hands the file to the share sheet: shared or cancelled; unsupported where there's no share sheet for files", async () => {
  const blob = pdfOf("FY");
  expect(await sharePdf(blob, NAME, "Statement · Anil Gupta")).toBe("unsupported"); // no share sheet (most computers)
  const share = vi.fn(async (_: ShareData) => {});
  Object.assign(navigator, { share, canShare: () => false });
  expect(await sharePdf(blob, NAME, "Statement · Anil Gupta")).toBe("unsupported"); // one that takes no files
  expect(share).not.toHaveBeenCalled();

  Object.assign(navigator, { canShare: (d: ShareData) => Boolean(d.files?.length) });
  expect(await sharePdf(blob, NAME, "Statement · Anil Gupta")).toBe("shared");
  const [{ files, title }] = share.mock.calls[0];
  expect(title).toBe("Statement · Anil Gupta");
  expect(files!.map((f) => [f.name, f.type, f.size])).toEqual([[NAME, "application/pdf", blob.size]]);

  share.mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));
  expect(await sharePdf(blob, NAME, "Statement · Anil Gupta")).toBe("cancelled");
  // refused for any other reason: the page downloads it instead
  share.mockRejectedValueOnce(new TypeError("Sharing failed"));
  expect(await sharePdf(blob, NAME, "Statement · Anil Gupta")).toBe("unsupported");
});


test("151 bills wait for a press, which makes once; a period switch drops both the file and waiting deliveries", async () => {
  const one = later<Blob>();
  const two = later<Blob>();
  vi.mocked(makeStatementPdf).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const FIRST = period("First", 151);
  const SECOND = period("Second", 200);
  const { result, rerender, unmount } = renderHook(({ data }) => useStatementPdf(data), { initialProps: { data: FIRST } });
  expect(makeStatementPdf).not.toHaveBeenCalled();
  let first!: Promise<Blob | null>;
  act(() => { first = result.current.make(); });
  expect(result.current.making).toBe(true);
  act(() => { void result.current.make(); });
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  rerender({ data: SECOND });
  expect(result.current.making).toBe(false);
  await act(async () => { one.resolve(pdfOf("First")); });
  expect(await first).toBeNull();
  expect(result.current.blob).toBeNull();
  let second!: Promise<Blob | null>;
  act(() => { second = result.current.make(); });
  unmount();
  await act(async () => { two.resolve(pdfOf("Second")); });
  expect(await second).toBeNull();
});

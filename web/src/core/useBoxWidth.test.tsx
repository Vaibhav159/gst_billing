import { act, render, screen } from "@testing-library/react";
import { useBoxWidth } from "./useBoxWidth";

function Box() {
  const [ref, w] = useBoxWidth();
  return <div ref={ref}>{`${w} px`}</div>;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("a box reads a desktop's 1400 px until it has been measured", () => {
  render(<Box />);
  expect(screen.getByText("1400 px")).toBeInTheDocument();
});

test("a box is measured as it's laid out and followed as it changes; the watch stops when the box goes", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1100 } as DOMRect);
  let resize: (width: number) => void = () => {};
  const watched: Element[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: ResizeObserverCallback) { resize = (width) => cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe(el: Element) { watched.push(el); }
    unobserve() {}
    disconnect = disconnect;
  });
  const { unmount } = render(<Box />);
  expect(screen.getByText("1100 px")).toBeInTheDocument();
  expect(watched).toEqual([screen.getByText("1100 px")]);
  act(() => resize(860.4));
  expect(screen.getByText("860 px")).toBeInTheDocument();
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("a browser without ResizeObserver keeps the width measured as the box was laid out", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 980 } as DOMRect);
  vi.stubGlobal("ResizeObserver", undefined);
  render(<Box />);
  expect(screen.getByText("980 px")).toBeInTheDocument();
});

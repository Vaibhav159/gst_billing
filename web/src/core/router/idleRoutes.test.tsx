// Ruling 1E-12: check the app's actual warm-up list without downloading any page or the PDF renderer.
import { isValidElement, type ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { paletteCode } from "@/core/shell/Palette";
import { capturePages } from "@/pages/purchases/capture/routes";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { appRoutes } from "./routes";
import { part2dRoutes } from "@/pages/imports/routes";

type Code = { load: () => Promise<unknown> };
const { queues, rendererLoaded, passwordCode } = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { queues: [] as Code[][], rendererLoaded: vi.fn(), passwordCode: { pending, release } };
});
vi.mock("./lazyPage", async (real) => {
  const actual = await real<typeof import("./lazyPage")>();
  return { ...actual, idlePages: (pages: Code[]) => { queues.push(pages); return actual.idlePages(pages); } };
});
vi.mock("@react-pdf/renderer", () => { rendererLoaded(); return {}; });
vi.mock("@/pages/people/ChoosePassword", async () => {
  await passwordCode.pending;
  return { default: () => <h1>Choose your own password</h1> };
});

const all = (routes: RouteObject[]): RouteObject[] => routes.flatMap((route) => [route, ...all(route.children ?? [])]);

test("the real routes warm every other lazy screen (GST returns and reports included) and Search records once, leaving the four import/supplier pages on demand, with no PDF renderer or API fetch", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  let idle!: IdleRequestCallback;
  const requestIdle = vi.fn((callback: IdleRequestCallback) => { idle = callback; return 1; });
  vi.stubGlobal("requestIdleCallback", requestIdle);
  const client = testQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
  let view: ReturnType<typeof render> | undefined;
  try {
    const pages = [...new Set(all(appRoutes).flatMap(({ element }) =>
      isValidElement(element) && typeof element.type !== "string" && "load" in element.type
        ? [element.type as unknown as Code] : []))];
    const owned = part2dRoutes.flatMap(({ element }) => isValidElement(element) ? [element.type as unknown as Code] : []);
    expect(owned).toHaveLength(4);
    for (const route of part2dRoutes) expect(all(appRoutes).find(r => r.path === route.path)?.element).toBe(route.element);
    expect(pages).toEqual(expect.arrayContaining(capturePages));
    // parts 3C and 3D's GST returns and report pages are warmed with the rest
    for (const path of ["/gst", "/reports", "/reports/:kind"]) {
      const element = all(appRoutes).find(r => r.path === path)?.element;
      expect(isValidElement(element) && pages.includes(element.type as unknown as Code)).toBe(true);
    }
    for (const page of owned) expect(pages).toContain(page);
    // the sign-in page sits inside its own boundary and Suspense, and is warmed too (X-47)
    const signIn = (all(appRoutes).find(r => r.path === "/login")?.element as ReactElement<{ children: ReactElement<{ children: ReactElement }> }>).props.children.props.children.type as unknown as Code;
    expect("load" in signIn).toBe(true);
    const expected: Code[] = [...pages.filter(page => !owned.includes(page)), signIn, paletteCode];
    for (const page of owned) expect(queues[0]).not.toContain(page);
    expect(queues).toHaveLength(1);
    expect(queues[0]).toHaveLength(expected.length);
    for (const page of expected) expect(queues[0]).toContain(page);
    const loads = expected.map((page) => vi.spyOn(page, "load").mockResolvedValue({}));
    const onDemandLoads = owned.map((page) => vi.spyOn(page, "load").mockResolvedValue({}));
    const { calls } = salesServer();
    expect(rendererLoaded).not.toHaveBeenCalled();
    expect(requestIdle).not.toHaveBeenCalled();
    const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>;
    view = render(tree());
    await act(async () => { await import("./NewShopGate"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(requestIdle).toHaveBeenCalledTimes(1);
    for (const load of loads) expect(load).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(client.isFetching()).toBe(0);
    const before = calls.length;
    await act(async () => idle({ didTimeout: false, timeRemaining: () => 50 }));
    for (const load of loads) expect(load).toHaveBeenCalledTimes(1);
    expect(rendererLoaded).not.toHaveBeenCalled();
    expect(calls).toHaveLength(before);
    for (const load of onDemandLoads) expect(load).not.toHaveBeenCalled();
    view.unmount();
    view = render(tree());
    expect(requestIdle).toHaveBeenCalledTimes(1);
    for (const load of loads) expect(load).toHaveBeenCalledTimes(1);
  } finally {
    view?.unmount(); router.dispose(); client.clear();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

test("More shares one lazy chunk between its two phone addresses and warming its code fetches no data", async () => {
  const more = all(appRoutes).find(({ path }) => path === "/more")?.element;
  const easy = all(appRoutes).find(({ path }) => path === "/e/more")?.element;
  if (!isValidElement(more) || !isValidElement(easy)) throw new Error("Both More routes must have a page.");
  expect(more.type).toHaveProperty("load", expect.any(Function));
  expect(easy.type).toBe(more.type);
  expect(queues[0]).toContain(more.type);
  const { calls } = salesServer();
  await (more.type as unknown as Code).load();
  expect(calls).toHaveLength(0);
  expect(rendererLoaded).not.toHaveBeenCalled();
});

test("the password chunk shows its loading state outside the shell until its code arrives", async () => {
  const { calls } = salesServer();
  const client = testQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/password"] });
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={stubAuth({ mustChangePassword: true })}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  try {
    expect(screen.getByRole("status")).toHaveTextContent("Loading your password page…");
    expect(document.querySelector("#app-main")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Choose your own password" })).not.toBeInTheDocument();
    await act(async () => { passwordCode.release(); });
    expect(await screen.findByRole("heading", { name: "Choose your own password" })).toBeInTheDocument();
    expect(document.querySelector("#app-main")).toBeNull();
    expect(calls).toHaveLength(0);
  } finally {
    await act(async () => { passwordCode.release(); });
    view.unmount(); router.dispose(); client.clear();
  }
});

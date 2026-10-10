import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { MemoryRouter } from "react-router";
import { __setNetState } from "@/core/api/network";
import { QueryView, StaleNote } from "./QueryView";

afterEach(() => { act(() => __setNetState("online")); vi.useRealTimers(); });

const wrap = (ui: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

/** A list that waits for something it needs before it asks (a firm that isn't known yet): enabled: false. */
function Waiting() {
  const q = useQuery({ queryKey: ["waiting"], queryFn: async () => "31 bills", enabled: false });
  return <QueryView query={q} what="the bills">{(d) => <p>got {d}</p>}</QueryView>;
}

test("a query waiting for what it needs isn't “still loading”, and offline it says you're offline", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  wrap(<Waiting />);
  expect(screen.getByRole("status")).toHaveTextContent(/loading the bills/i);
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.queryByText(/Still loading/)).not.toBeInTheDocument();
  act(() => __setNetState("offline"));
  expect(await screen.findByText("You're offline")).toBeInTheDocument();
});

test("bills already shown stay when asking again fails, with what went wrong and Try again", async () => {
  let fail = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Bills() {
    const q = useQuery({
      queryKey: ["bills"],
      queryFn: async () => { if (fail) throw new AxiosError("Network Error", "ERR_NETWORK", {} as InternalAxiosRequestConfig); return "31 bills"; },
    });
    return <QueryView query={q} what="the bills">{(d) => <p>got {d}</p>}</QueryView>;
  }
  wrap(<Bills />, client);
  expect(await screen.findByText("got 31 bills")).toBeInTheDocument();
  fail = true;
  await act(async () => { await client.refetchQueries({ queryKey: ["bills"] }); });
  // TanStack tells the screen a moment later (its notifications are batched): find waits for it
  expect(await screen.findByText("Couldn't refresh the bills")).toBeInTheDocument();
  expect(screen.getByText("got 31 bills")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't reach the shop's records just now, so this is what was last loaded.")).toBeInTheDocument();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Couldn't refresh the bills")).not.toBeInTheDocument());
  expect(screen.getByText("got 31 bills")).toBeInTheDocument();
});

test("Try again shows it's working while the bills are asked for again, and a second press doesn't ask again", async () => {
  let mode: "ok" | "fail" | "hold" = "ok";
  let asked = 0;
  let answer = () => {};
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Bills() {
    const q = useQuery({
      queryKey: ["bills"],
      queryFn: async () => {
        asked += 1;
        if (mode === "hold") await new Promise<void>((done) => { answer = done; });
        if (mode === "fail") throw new AxiosError("Network Error", "ERR_NETWORK", {} as InternalAxiosRequestConfig);
        return "31 bills";
      },
    });
    return <QueryView query={q} what="the bills">{(d) => <p>got {d}</p>}</QueryView>;
  }
  wrap(<Bills />, client);
  expect(await screen.findByText("got 31 bills")).toBeInTheDocument();
  mode = "fail";
  await act(async () => { await client.refetchQueries({ queryKey: ["bills"] }); });
  const tryAgain = () => screen.getByRole("button", { name: "Try again" });
  await waitFor(() => expect(tryAgain()).not.toHaveAttribute("aria-busy"));
  mode = "hold";
  await userEvent.click(tryAgain());
  await waitFor(() => expect(tryAgain()).toHaveAttribute("aria-busy", "true"));
  expect(asked).toBe(3);
  await userEvent.click(tryAgain());
  expect(asked).toBe(3);
  await act(async () => { answer(); });
  await waitFor(() => expect(screen.queryByText("Couldn't refresh the bills")).not.toBeInTheDocument());
  expect(screen.getByText("got 31 bills")).toBeInTheDocument();
});

test("offline, the note over the bills says they refresh once the device is back, and has no Try again", () => {
  wrap(<StaleNote problem={{ kind: "offline", message: "You're offline" }} what="the bills" retry={() => {}} />);
  expect(screen.getByText("Couldn't refresh the bills")).toBeInTheDocument();
  expect(screen.getByText("You're offline, so this is what was last loaded. It refreshes when you're back online.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test.each([
  ["forbidden", "Your role can't do this. Ask the owner if you need it."],
  ["notfound", "That isn't there any more."],
  ["throttled", "Too many tries. Wait a minute, then try again."],
] as const)("a refresh that fails as %s says its own words, then that this is what was last loaded, with Try again", async (kind, message) => {
  const retry = vi.fn();
  wrap(<StaleNote problem={{ kind, message }} what="the bills" retry={retry} />);
  expect(screen.getByText(`${message} This is what was last loaded.`)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test("offline, a list waiting for what it needs has no Try again: it loads by itself once the device is back", async () => {
  act(() => __setNetState("offline"));
  wrap(<Waiting />);
  expect(await screen.findByText("You're offline")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

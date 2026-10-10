import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { MemoryRouter } from "react-router";
import { __setNetState } from "@/core/api/network";
import { QueryView } from "./QueryView";

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

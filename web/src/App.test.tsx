import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import type { AxiosAdapter } from "axios";
import { api, setTokens } from "@/core/api/client";
import { appRoutes } from "@/core/router/routes";
import App, { AppRoutes } from "./App";

const realAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = realAdapter; });

test("signed out, the app opens on the sign-in page", async () => {
  localStorage.clear();
  render(<App />);
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/login");
});

/** A SimpleJWT-shaped access token naming `userId`. */
const jwt = (userId: number) => ["e30", btoa(JSON.stringify({ token_type: "access", user_id: userId })).replace(/=+$/, ""), "sig"].join(".");

test("when another tab signs in as someone else, the app says who is signed in now, once (Ruling 30)", async () => {
  localStorage.clear();
  const people: Record<string, object> = {
    [jwt(1)]: { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false },
    [jwt(7)]: { id: 7, username: "rakesh", full_name: "Rakesh Soni", role: "staff", role_label: "Counter staff", permissions: ["view", "bill.create"], needs_role_choice: false },
  };
  // /api/me/ answers for whoever the request's token names; the shell's preferences and firm list come back empty
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("preferences/") ? { data: {} } : config.url?.startsWith("businesses/") ? { results: [] }
      : people[String(config.headers.Authorization).replace(/^Bearer /, "")] })) as AxiosAdapter;
  setTokens(jwt(1), "r1");
  render(<AppRoutes router={createMemoryRouter(appRoutes, { initialEntries: ["/sales"] })} />);
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  expect(screen.queryByText(/^Signed in as/)).not.toBeInTheDocument(); // this tab's own start isn't news

  // another tab signs in as Rakesh; this tab hears it as a storage event
  act(() => {
    localStorage.setItem("gst_access_token", jwt(7));
    window.dispatchEvent(new StorageEvent("storage", { key: "gst_access_token", oldValue: jwt(1), newValue: jwt(7) }));
  });
  expect(await screen.findAllByText("Signed in as Rakesh Soni")).toHaveLength(1);
});

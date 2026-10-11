import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthValue } from "@/core/auth/AuthProvider";
import Login from "./Login";

// The password help's code can't load: offline, or a stale tab after a release removed the old file.
vi.mock("@/pages/people/ForgotPassword", () => { throw new Error("Failed to fetch dynamically imported module"); });

test("password help that can't load keeps the sign-in page and still says what to do", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const auth = { me: null, status: "signed-out", startProblem: null, expiredFrom: null, signIn: vi.fn(), signOut: () => {}, retryStart: () => {}, can: () => false, whyNot: () => "" } as unknown as AuthValue;
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={["/login"]}><Login /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  const dialog = await screen.findByRole("dialog", { name: "Forgot your password?" });
  expect(dialog).toHaveTextContent("The owner sets a new password for you in Users and roles.");
  expect(dialog).toHaveTextContent("Password help couldn't load.");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});


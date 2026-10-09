import { render, screen } from "@testing-library/react";
import App from "./App";

test("signed out, the app opens on the sign-in page", async () => {
  localStorage.clear();
  render(<App />);
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/login");
});

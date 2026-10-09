import { render, screen } from "@testing-library/react";
import App from "./App";

test("the app mounts and names itself", () => {
  render(<App />);
  expect(screen.getByText("GST Billing")).toBeInTheDocument();
});

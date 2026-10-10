import type { ReactElement } from "react";
import { matchRoutes } from "react-router";
import { appRoutes } from "@/core/router/routes";
import Placeholder from "@/pages/core/Placeholder";
import CustomerForm from "./CustomerForm";
import CustomerPage from "./CustomerPage";
import CustomerStatement from "./CustomerStatement";
import Customers from "./Customers";

test("every customer address opens its screen, not a placeholder; forms hide the phone's tabs, the rest keep them", () => {
  const screens: [string, unknown, boolean][] = [
    ["/customers", Customers, false], ["/customers/new", CustomerForm, true], ["/customers/7", CustomerPage, false],
    ["/customers/7/edit", CustomerForm, true], ["/customers/7/statement", CustomerStatement, false],
  ];
  for (const [path, screen, hidesTabs] of screens) {
    const m = matchRoutes(appRoutes, path)!;
    const route = m[m.length - 1].route;
    expect((route.element as ReactElement).type, path).toBe(screen);
    expect((route.element as ReactElement).type, path).not.toBe(Placeholder);
    expect(Boolean(route.handle?.hideNav), path).toBe(hidesTabs);
  }
});

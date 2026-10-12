import { isValidElement } from "react";
import { matchRoutes, type RouteObject } from "react-router";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";
import Home from "./Home";
import Bills from "./Bills";
import BillDetail from "./BillDetail";
import Customers, { CustomerNew, CustomerEdit } from "./CustomerRoutes";
import More from "./More";
import Profile from "./Profile";
import { easyEverydayPages } from "./routes";

const flatten = (routes: RouteObject[]): RouteObject[] => routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
const cases = [
  { path: "/e", pattern: "/e", screen: Home, hideNav: false },
  { path: "/e/bills", pattern: "/e/bills", screen: Bills, hideNav: false },
  { path: "/e/bill/412", pattern: "/e/bill/:id", screen: BillDetail, hideNav: false },
  { path: "/e/customers", pattern: "/e/customers", screen: Customers, hideNav: false },
  { path: "/e/customers/new", pattern: "/e/customers/new", screen: CustomerNew, hideNav: true },
  { path: "/e/customers/7/edit", pattern: "/e/customers/:id/edit", screen: CustomerEdit, hideNav: true },
  { path: "/e/more", pattern: "/e/more", screen: More, hideNav: false },
  { path: "/e/profile", pattern: "/e/profile", screen: Profile, hideNav: false },
];

test.each(cases)("$path resolves to its one real lazy Everyday screen, hideNav=$hideNav", async ({ path, pattern, screen, hideNav }) => {
  const matches = matchRoutes(appRoutes, path);
  expect(matches, path).not.toBeNull();
  const route = matches![matches!.length - 1].route;
  expect(route.path).toBe(pattern);
  expect(flatten(appRoutes).filter((candidate) => candidate.path === pattern)).toHaveLength(1);
  expect(await loadedPage(route.element), path).toBe(screen);
  expect(Boolean(route.handle?.hideNav), path).toBe(hideNav);
  expect(isValidElement(route.element)).toBe(true);
  if (!isValidElement(route.element)) throw new Error(`No route element for ${path}`);
  expect(typeof route.element.type !== "string" && "load" in route.element.type).toBe(true);
  expect(easyEverydayPages).toHaveLength(8);
  expect(easyEverydayPages).toContain(route.element.type);
});

import { isValidElement } from "react";
import { matchRoutes, type RouteObject } from "react-router";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";

const flatten = (routes: RouteObject[]): RouteObject[] => routes.flatMap(route => [route, ...flatten(route.children ?? [])]);
test.each([
  ["/e/capture", () => import("./Capture")],
  ["/e/gst", () => import("./Gst")],
] as const)("%s has one lazy screen inside the existing app shell with tabs", async (path, load) => {
  const matches = matchRoutes(appRoutes, path)!;
  const route = matches.at(-1)!.route;
  expect(matches.length).toBe(3);
  expect(flatten(appRoutes).filter(candidate => candidate.path === path)).toHaveLength(1);
  expect(isValidElement(route.element)).toBe(true);
  expect(Boolean(route.handle?.hideNav)).toBe(false);
  expect(await loadedPage(route.element)).toBe((await load()).default);
});

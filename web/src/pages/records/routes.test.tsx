import { matchRoutes } from "react-router";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";
import Audit from "./Audit";
import Backup from "./Backup";

test.each([["/audit", Audit], ["/audit?restore=90", Audit], ["/backup", Backup]] as const)("%s opens the Records page lazily", async (path, page) => {
  const match = matchRoutes(appRoutes, path)?.at(-1);
  expect(await loadedPage(match?.route.element)).toBe(page);
});

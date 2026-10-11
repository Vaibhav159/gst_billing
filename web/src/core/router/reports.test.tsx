import { matchRoutes } from "react-router";
import { appRoutes } from "./routes";
import { loadedPage } from "./lazyPage";
import Reports from "@/pages/reports/Reports";

test.each(["/reports", "/reports/sales", "/reports/purchases", "/reports/tax", "/reports/hsn", "/reports/months", "/reports/customers", "/reports/products"])("%s loads the reports page on demand", async (path) => {
  const matched = matchRoutes(appRoutes, path);
  expect(await loadedPage(matched?.at(-1)?.route.element)).toBe(Reports);
});

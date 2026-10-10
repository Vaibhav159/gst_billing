import { Navigate, useParams, type RouteObject } from "react-router";
import { RequireAuth } from "@/core/auth/RequireAuth";
import { AppLayout, RootLayout } from "@/core/shell/AppLayout";
import Login from "@/pages/core/Login";
import More from "@/pages/core/More";
import NotFound from "@/pages/core/NotFound";
import Placeholder from "@/pages/core/Placeholder";

/** What each placeholder names: the area, and the part of v3 that builds it. */
export const PARTS: Record<string, { part: number; area: string }> = {
  dashboard: { part: 5, area: "Dashboard" },
  sales: { part: 1, area: "Bills" },
  customers: { part: 1, area: "Customers" },
  purchases: { part: 2, area: "Purchases" },
  gst: { part: 3, area: "GST" },
  records: { part: 4, area: "Records and admin" },
  easy: { part: 6, area: "Easy" },
};

/** Every page in the prototype (PROTO/pages/<area>/index.js) that a later part builds, by area. Sign-in and More are already built (below). */
const PAGES: Record<string, string[]> = {
  dashboard: ["/"],
  sales: [
    "/sales", "/sales/paper", "/sales/new", "/sales/batch", "/sales/export", "/sales/:id", "/sales/:id/edit", "/sales/:id/print",
    "/billing/invoice/:bizSlug/:fy/:slug", // v2's links by bill number
  ],
  customers: ["/customers", "/customers/new", "/customers/:id", "/customers/:id/edit", "/customers/:id/statement"],
  purchases: [
    "/purchases", "/purchases/new", "/purchases/capture", "/purchases/inbox", "/purchases/inbox/:id", "/purchases/ai-import", "/purchases/:id", "/purchases/:id/edit",
    "/capture", "/import", "/scan", "/suppliers", "/suppliers/:id",
  ],
  gst: ["/gst", "/reports", "/reports/:kind"],
  records: [
    "/products", "/products/new", "/products/:id", "/products/:id/edit", "/firms", "/firms/new", "/firms/:id", "/firms/:id/edit",
    "/users", "/backup", "/audit", "/settings", "/profile", "/setup",
  ],
  easy: [
    "/e", "/e/bills", "/e/new", "/e/new/items", "/e/saved/:id", "/e/bill/:id", "/e/capture", "/e/customers", "/e/customers/new", "/e/customers/:id/edit",
    "/e/gst", "/e/profile",
  ],
};

/** The prototype's `hideNav`: forms and print, where the phone's tabs make way. Task 16's PhoneShell reads `handle.hideNav`. */
const HIDE_NAV = new Set([
  "/sales/new", "/sales/:id/edit", "/sales/:id/print", "/customers/new", "/customers/:id/edit", "/purchases/new", "/purchases/:id/edit", "/purchases/inbox/:id",
  "/products/new", "/products/:id/edit", "/firms/new", "/firms/:id/edit", "/e/new", "/e/new/items", "/e/customers/new", "/e/customers/:id/edit",
]);

/**
 * Every address in v2 (sweet-rebuild-suite-main/src/App.tsx) except /login, / and *, and where it lives now.
 * /billing/invoice/:id may be a purchase (v2 kept purchases as inward invoices): part 1's bill page sends those on.
 */
export const V2_REDIRECTS: [string, (p: Record<string, string>) => string][] = [
  ["/billing", () => "/"],
  ["/billing/customer/list", () => "/customers"], ["/billing/customer/new", () => "/customers/new"], ["/billing/customer/import", () => "/import"],
  ["/billing/customer/edit/:id", (p) => `/customers/${p.id}/edit`], ["/billing/customer/:id/statement", (p) => `/customers/${p.id}/statement`], ["/billing/customer/:id", (p) => `/customers/${p.id}`],
  ["/billing/business/list", () => "/firms"], ["/billing/business/new", () => "/firms/new"], ["/billing/business/import", () => "/import"],
  ["/billing/business/edit/:id", (p) => `/firms/${p.id}/edit`], ["/billing/business/:id", (p) => `/firms/${p.id}`],
  ["/billing/invoice/list", () => "/sales"], ["/billing/invoice/add", () => "/sales/new"], ["/billing/invoice/import", () => "/import"], ["/billing/invoice/ai-import", () => "/purchases/ai-import"],
  ["/billing/invoice/edit/:id", (p) => `/sales/${p.id}/edit`], ["/billing/invoice/:id/print", (p) => `/sales/${p.id}/print`], ["/billing/invoice/:id/print-classic", (p) => `/sales/${p.id}/print`], ["/billing/invoice/:id", (p) => `/sales/${p.id}`],
  ["/billing/batch-print", () => "/sales/batch"], ["/billing/bulk-pdf", () => "/sales/export"],
  ["/billing/inward-bills", () => "/purchases"], ["/billing/inward-bills/add", () => "/purchases/new"], ["/billing/inward-bills/capture", () => "/purchases/capture"], ["/billing/inward-bills/:id", (p) => `/purchases/${p.id}`],
  ["/billing/product/list", () => "/products"], ["/billing/product/new", () => "/products/new"], ["/billing/product/import", () => "/import"],
  ["/billing/product/edit/:id", (p) => `/products/${p.id}/edit`], ["/billing/product/:id", (p) => `/products/${p.id}`],
  ["/billing/gst-summary", () => "/gst"], ["/billing/gstr-export", () => "/gst"], ["/billing/reports", () => "/reports"],
  ["/billing/import/preview", () => "/import"], ["/billing/import/review", () => "/import"],
  ["/billing/qr-scanner", () => "/scan"], ["/billing/users", () => "/users"], ["/billing/settings", () => "/settings"],
  ["/billing/profile", () => "/profile"], ["/billing/audit-log", () => "/audit"], ["/billing/backup", () => "/backup"],
];

function V2Redirect({ to }: { to: (p: Record<string, string>) => string }) {
  const params = useParams() as Record<string, string>;
  return <Navigate to={to(params)} replace />;
}

export const appRoutes: RouteObject[] = [{
  element: <RootLayout />,
  children: [
    { path: "/login", element: <Login /> },
    // outside the sign-in check, so a signed-out visit is sent to sign in with the new address to come back to
    ...V2_REDIRECTS.map(([path, to]): RouteObject => ({ path, element: <V2Redirect to={to} /> })),
    {
      element: <RequireAuth><AppLayout /></RequireAuth>,
      children: [
        // the home is the phone's Today: its header carries search, as the prototype's does (part 5's page keeps it)
        ...Object.entries(PAGES).flatMap(([area, paths]) => paths.map((path): RouteObject => ({
          path, element: <Placeholder {...PARTS[area]} phoneSearch={path === "/"} />, handle: HIDE_NAV.has(path) ? { hideNav: true } : undefined,
        }))),
        // the phone's More tab, in Expert and in Easy (part 6 brings Easy's own)
        { path: "/more", element: <More /> },
        { path: "/e/more", element: <More /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
}];

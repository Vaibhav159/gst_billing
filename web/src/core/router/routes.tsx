import { Suspense } from "react";
import { Navigate, useLocation, useParams, type RouteObject } from "react-router";
import { RequireAuth } from "@/core/auth/RequireAuth";
import { AppLayout, RootLayout } from "@/core/shell/AppLayout";
import { paletteCode } from "@/core/shell/Palette";
import { AppFailed } from "@/core/shell/ScreenBoundary";
import { ListSkeleton } from "@/core/ui";
import Login from "@/pages/core/Login";
import NotFound from "@/pages/core/NotFound";
import Placeholder from "@/pages/core/Placeholder";
import { capturePages, captureRoutes } from "@/pages/purchases/capture/routes";
import { customerPages, customerRoutes } from "@/pages/customers/routes";
import { part2dRoutes } from "@/pages/imports/routes";
import { firmPages, firmRoutes } from "@/pages/firms/routes";
import { productPages, productRoutes } from "@/pages/products/routes";
import { idlePages, lazyPage } from "./lazyPage";

// Selling's pages load on demand (Ruling 1B-4): code comes as each page opens, or while idle after a real page shows.
// react-pdf comes later still, with the first PDF made (core/print/make.ts).
const GstReturns = lazyPage(() => import("@/pages/gst/GstReturns"));
const SetupPage = lazyPage(() => import("@/pages/records/Setup"));
const SettingsPage = lazyPage(() => import("@/pages/records/Settings"));
const UsersPage = lazyPage(() => import("@/pages/people/Users"));
const ProfilePage = lazyPage(() => import("@/pages/people/Profile"));
const ChoosePassword = lazyPage(() => import("@/pages/people/ChoosePassword"));
const More = lazyPage(() => import("@/pages/core/More"));

const SalesList = lazyPage(() => import("@/pages/sales/SalesList"));
const BillPage = lazyPage(() => import("@/pages/sales/BillPage"));
const V2NumberLink = lazyPage(() => import("@/pages/sales/V2NumberLink"));
const NewBillPage = lazyPage(() => import("@/pages/sales/form/BillFormPage"));
const EditBillPage = lazyPage(() => import("@/pages/sales/form/EditBillPage"));
const PaperBookPage = lazyPage(() => import("@/pages/sales/paper/PaperBook"));
const PrintPage = lazyPage(() => import("@/pages/sales/print/PrintPage"));
const ScanPage = lazyPage(() => import("@/pages/sales/print/ScanPage"));
const BatchPrint = lazyPage(() => import("@/pages/sales/print/BatchPrint"));
const BulkExport = lazyPage(() => import("@/pages/sales/print/BulkExport"));
const PurchaseList = lazyPage(() => import('@/pages/purchases/PurchaseList'));
const PurchasePage = lazyPage(() => import('@/pages/purchases/PurchasePage'));
const PurchaseFormPage = lazyPage(() => import('@/pages/purchases/form/PurchaseFormPage'));
const Reports = lazyPage(() => import("@/pages/reports/Reports"));

const warmPages = idlePages([GstReturns, SalesList, BillPage, V2NumberLink, NewBillPage, EditBillPage, PaperBookPage, PrintPage, ScanPage, BatchPrint, BulkExport, Reports, PurchaseList, PurchasePage, PurchaseFormPage, ...customerPages, ...capturePages, ...productPages, ...firmPages, SettingsPage, SetupPage, UsersPage, ProfilePage, More, paletteCode]);

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
  purchases: [
    "/purchases", "/purchases/new", "/purchases/capture", "/purchases/inbox", "/purchases/inbox/:id", "/purchases/ai-import", "/purchases/:id", "/purchases/:id/edit",
    "/capture", "/import", "/suppliers", "/suppliers/:id",
  ],
  gst: ["/gst", "/reports", "/reports/:kind"],
  records: [
    "/products", "/products/new", "/products/:id", "/products/:id/edit", "/firms", "/firms/new", "/firms/:id", "/firms/:id/edit",
    "/backup", "/audit", "/settings", "/setup",
  ],
  easy: [
    "/e", "/e/bills", "/e/new", "/e/new/items", "/e/saved/:id", "/e/bill/:id", "/e/capture", "/e/customers", "/e/customers/new", "/e/customers/:id/edit",
    "/e/gst", "/e/profile",
  ],
};

/** The prototype's `hideNav`: forms and print, where the phone's tabs make way. Task 16's PhoneShell reads `handle.hideNav`. */
const HIDE_NAV = new Set([
  "/sales/:id/print", "/purchases/new", "/purchases/:id/edit", "/purchases/inbox/:id",
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
  ["/inward-bills/:id", (p) => `/purchases/${p.id}`],
  ["/billing/product/list", () => "/products"], ["/billing/product/new", () => "/products/new"], ["/billing/product/import", () => "/import"],
  ["/billing/product/edit/:id", (p) => `/products/${p.id}/edit`], ["/billing/product/:id", (p) => `/products/${p.id}`],
  ["/billing/gst-summary", () => "/gst"], ["/billing/gstr-export", () => "/gst"], ["/billing/reports", () => "/reports"],
  ["/billing/import/preview", () => "/import"], ["/billing/import/review", () => "/import"],
  ["/billing/qr-scanner", () => "/scan"], ["/billing/users", () => "/users"], ["/billing/settings", () => "/settings"],
  ["/billing/profile", () => "/profile"], ["/billing/audit-log", () => "/audit"], ["/billing/backup", () => "/backup"],
];

function V2Redirect({ to }: { to: (p: Record<string, string>) => string }) {
  const params = useParams() as Record<string, string>;
  const { search } = useLocation(); // the query string goes too: a list's filter, or v2's ?b= firm hint on a bill number
  return <Navigate to={`${to(params)}${search}`} replace />;
}

export const appRoutes: RouteObject[] = [{
  element: <RootLayout />,
  // a page has its own ScreenBoundary; anything else that fails to draw lands here
  errorElement: <AppFailed />,
  children: [
    { path: "/login", element: <Login /> },
    { path: "/password", element: <RequireAuth><Suspense fallback={<div className="p-6"><ListSkeleton what="your password page" /></div>}><ChoosePassword /></Suspense></RequireAuth> },
    // outside the sign-in check, so a signed-out visit is sent to sign in with the new address to come back to
    ...V2_REDIRECTS.map(([path, to]): RouteObject => ({ path, element: <V2Redirect to={to} /> })),
    {
      element: <RequireAuth><AppLayout onShown={warmPages} /></RequireAuth>,
      children: [
        // part 1C's customer screens, ahead of the placeholders: of two routes with one path, the first wins
        ...customerRoutes,
        ...captureRoutes,
        // Part 2D pages stay lazy and ahead of their placeholders.
        ...part2dRoutes,
        { path: "/gst", element: <GstReturns /> },
        { path: '/purchases', element: <PurchaseList /> },
        { path: '/purchases/new', element: <PurchaseFormPage />, handle: { hideNav: true } },
        { path: '/purchases/:id/edit', element: <PurchaseFormPage />, handle: { hideNav: true } },
        { path: '/purchases/:id', element: <PurchasePage /> },
        ...productRoutes,
        ...firmRoutes,
        { path: "/settings", element: <SettingsPage /> },
        { path: "/setup", element: <SetupPage /> },
        { path: "/users", element: <UsersPage /> },
        { path: "/profile", element: <ProfilePage /> },
        // part 1D's pages, ahead of the placeholders: the bill form (the phone's tabs make way on it)
        { path: "/sales/new", element: <NewBillPage />, handle: { hideNav: true } },
        { path: "/sales/paper", element: <PaperBookPage /> },
        { path: "/sales/:id/edit", element: <EditBillPage />, handle: { hideNav: true } },
        // part 1B: the bills list and a bill's own page
        { path: "/sales", element: <SalesList /> },
        { path: "/sales/:id", element: <BillPage /> },
        { path: "/billing/invoice/:bizSlug/:fy/:slug", element: <V2NumberLink /> }, // v2's links by bill number
        // part 1E: print and share, a page with no phone tabs (the prototype's hideNav)
        { path: "/sales/:id/print", element: <PrintPage />, handle: { hideNav: true } },
        // part 1E: a bill's QR code checked, on a page of its own (More's link and v2's QR scanner; Ruling 1E-7)
        { path: "/scan", element: <ScanPage /> },
        { path: "/sales/batch", element: <BatchPrint /> },
        { path: "/sales/export", element: <BulkExport /> },
        { path: "/reports", element: <Reports /> },
        { path: "/reports/:kind", element: <Reports /> },
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

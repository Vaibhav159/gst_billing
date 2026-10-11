// The customer screens' routes (part 1C). core/router/routes.tsx puts them ahead of the placeholders.
import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";

// each screen loads on demand (Ruling 1B-4, plan 1E)
const CustomerForm = lazyPage(() => import("./CustomerForm"));
const CustomerPage = lazyPage(() => import("./CustomerPage"));
const CustomerStatement = lazyPage(() => import("./CustomerStatement"));
const Customers = lazyPage(() => import("./Customers"));

// The form has two addresses, but its code needs only one idle load.
export const customerPages = [CustomerForm, CustomerPage, CustomerStatement, Customers];

export const customerRoutes: RouteObject[] = [
  { path: "/customers", element: <Customers /> },
  // forms hide the phone's tabs (the prototype's hideNav)
  { path: "/customers/new", element: <CustomerForm />, handle: { hideNav: true } },
  { path: "/customers/:id/edit", element: <CustomerForm />, handle: { hideNav: true } },
  { path: "/customers/:id", element: <CustomerPage /> },
  { path: "/customers/:id/statement", element: <CustomerStatement /> },
];

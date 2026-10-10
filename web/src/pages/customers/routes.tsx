// The customer screens' routes (part 1C). core/router/routes.tsx puts them ahead of the placeholders.
import type { RouteObject } from "react-router";
import CustomerForm from "./CustomerForm";

export const customerRoutes: RouteObject[] = [
  // forms hide the phone's tabs (the prototype's hideNav)
  { path: "/customers/new", element: <CustomerForm />, handle: { hideNav: true } },
  { path: "/customers/:id/edit", element: <CustomerForm />, handle: { hideNav: true } },
];

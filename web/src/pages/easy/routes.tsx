import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";

const Home = lazyPage(() => import("./Home"));
const Bills = lazyPage(() => import("./Bills"));
const BillDetail = lazyPage(() => import("./BillDetail"));
const Customers = lazyPage(() => import("./CustomerRoutes"));
const CustomerNew = lazyPage(() => import("./CustomerRoutes").then((module) => ({ default: module.CustomerNew })));
const CustomerEdit = lazyPage(() => import("./CustomerRoutes").then((module) => ({ default: module.CustomerEdit })));
const More = lazyPage(() => import("./More"));
const Profile = lazyPage(() => import("./Profile"));

export const easyEverydayPages = [Home, Bills, BillDetail, Customers, CustomerNew, CustomerEdit, More, Profile];
export const easyEverydayRoutes: RouteObject[] = [
  { path: "/e", element: <Home /> },
  { path: "/e/bills", element: <Bills /> },
  { path: "/e/bill/:id", element: <BillDetail /> },
  { path: "/e/customers", element: <Customers /> },
  { path: "/e/customers/new", element: <CustomerNew />, handle: { hideNav: true } },
  { path: "/e/customers/:id/edit", element: <CustomerEdit />, handle: { hideNav: true } },
  { path: "/e/more", element: <More /> },
  { path: "/e/profile", element: <Profile /> },
];

import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";
const FirmForm = lazyPage(() => import("./FirmForm"));
const Firms = lazyPage(() => import("./Firms"));
const FirmDetail = lazyPage(() => import("./FirmDetail"));
export const firmPages = [Firms, FirmDetail, FirmForm];
export const firmRoutes: RouteObject[] = [{ path: "/firms/new", element: <FirmForm />, handle: { hideNav: true } }, { path: "/firms/:id/edit", element: <FirmForm />, handle: { hideNav: true } }, { path: "/firms", element: <Firms /> }, { path: "/firms/:id", element: <FirmDetail /> }];

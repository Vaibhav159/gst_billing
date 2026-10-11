import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";
const Firms = lazyPage(() => import("./Firms"));
const FirmDetail = lazyPage(() => import("./FirmDetail"));
export const firmPages = [Firms, FirmDetail];
export const firmRoutes: RouteObject[] = [{ path: "/firms", element: <Firms /> }, { path: "/firms/:id", element: <FirmDetail /> }];

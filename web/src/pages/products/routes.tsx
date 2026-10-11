import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";
const Products = lazyPage(() => import("./Products"));
const ProductDetail = lazyPage(() => import("./ProductDetail"));
export const productPages = [Products, ProductDetail];
export const productRoutes: RouteObject[] = [{ path: "/products", element: <Products /> }, { path: "/products/:id", element: <ProductDetail /> }];

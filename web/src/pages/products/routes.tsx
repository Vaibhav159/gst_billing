import type { RouteObject } from "react-router";
import { lazyPage } from "@/core/router/lazyPage";
const Products = lazyPage(() => import("./Products"));
const ProductDetail = lazyPage(() => import("./ProductDetail"));
const ProductForm = lazyPage(() => import("./ProductForm"));
export const productPages = [Products, ProductDetail, ProductForm];
export const productRoutes: RouteObject[] = [{ path: "/products", element: <Products /> }, { path: "/products/new", element: <ProductForm />, handle: { hideNav: true } }, { path: "/products/:id/edit", element: <ProductForm />, handle: { hideNav: true } }, { path: "/products/:id", element: <ProductDetail /> }];

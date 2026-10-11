import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { firmListQuery } from "@/core/api/firms";
import { useAuth } from "@/core/auth/AuthProvider";
import { Card, Page, QueryView } from "@/core/ui";

/** Reuse the shell's complete slim list: no extra dashboard request and no empty-shop guess. */
export function NewShopGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const home = pathname === "/" || pathname === "/e";
  const firms = useQuery({ ...firmListQuery(), enabled: home });
  if (!home) return children;
  return <QueryView query={firms} what="firms">{(rows) => rows.length ? children : can("firm.edit") ? <Navigate to="/setup" replace /> : <Page title="Set up GST Billing"><Card><p>Ask the owner to add the business first</p></Card></Page>}</QueryView>;
}


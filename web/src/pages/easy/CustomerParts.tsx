import type { ComponentType, ReactNode } from "react";
import type { Firm } from "@/core/scope";

/** The page body accepts 6B's EasyPage; keeping the seam explicit also serves 6C's bill layout. */
export type CustomerFrameProps = { title: string; subtitle?: ReactNode; docTitle?: string; back?: true; bar?: ReactNode; children?: ReactNode };
export type CustomerFrame = ComponentType<CustomerFrameProps>;
/** City comes from 4C's cached firmListQuery(), not the older slim useFirms mapper. */
export type CustomerFirm = Firm & { city: string };

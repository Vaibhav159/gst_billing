import type { FirmId } from "@/core/scope";

export const dueNextKeys = { all: ["due-next"] as const, scope: (firm: FirmId | null) => ["due-next", firm] as const, one: (firm: FirmId | null, withReturns = false) => ["due-next", firm, withReturns] as const };

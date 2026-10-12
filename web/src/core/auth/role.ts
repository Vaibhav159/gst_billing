import { createContext, useContext } from "react";
export type Role = "owner" | "accountant" | "staff" | "viewer";
/** The signed-in person's role, for wording only (permissions come from useAuth().can). Null before sign-in. */
export const RoleContext = createContext<Role | null>(null);
export const useRole = () => useContext(RoleContext);

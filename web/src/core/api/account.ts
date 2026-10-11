import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/core/auth/role";
import { api, getTokens } from "./client";
import { sameTokenSession } from "@/core/auth/session";
import { usePrivateMutation, type TokenPair, type Detail } from "./auth";

export type AccountProfile = { id: number; username: string; first_name: string; last_name: string; email: string; role: Role; role_label: string; usual_firm: {id:number; name:string; short:string} | null; phone: string | null; phone_allowed: boolean; sms_reset: boolean; must_change_password: boolean };
export type Profile = AccountProfile;
export type Session = { id: string; device: string; created_at: string; last_used_at: string; current: boolean };
export type ProfileInput = Pick<AccountProfile, "first_name" | "last_name" | "email"> & { phone?: string };
export type PasswordAnswer = TokenPair & Detail & { changed_at: string; requestAccess: string | null };
export function useProfile() { return useQuery({ queryKey: ["account"], queryFn: async ({ signal }) => (await api.get<AccountProfile>("account/", { signal })).data }); }
export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: ProfileInput) => {
    const before = getTokens().access;
    const response = await api.patch<AccountProfile>("account/", input, before ? { headers: { Authorization: `Bearer ${before}` } } : undefined);
    // The successful retry may carry a refreshed legacy token with no sid.
    const sent = String(response.config.headers.Authorization ?? "").replace(/^Bearer /, "") || before;
    const current = getTokens().access;
    if (sent === current || sameTokenSession(sent, current)) {
      qc.setQueryData(["account"], response.data);
      await Promise.all([qc.invalidateQueries({ queryKey: ["people"] }), qc.invalidateQueries({ queryKey: ["audit"] })]);
    }
    return response.data;
  } });
}
export function useChangePassword() {
  const qc = useQueryClient();
  return usePrivateMutation(async (input: { current: string; password: string }) => { const requestAccess = getTokens().access; const response = await api.post<PasswordAnswer>("account/password/", input, requestAccess ? {headers:{Authorization:`Bearer ${requestAccess}`}} : undefined); return { ...response.data, requestAccess: String(response.config.headers.Authorization ?? "").replace(/^Bearer /, "") || requestAccess }; },
    () => { qc.removeQueries({queryKey:["account","sessions"]}); });
}
export function useSessions() { return useQuery({ queryKey: ["account", "sessions"], queryFn: async ({ signal }) => (await api.get<{ results: Session[] }>("account/sessions/", { signal })).data }); }
export function useSignOutSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => { await api.post(`account/sessions/${encodeURIComponent(id)}/sign-out/`); },
    onSuccess: () => qc.invalidateQueries({queryKey:["account","sessions"]}) });
}
export function useSignOutOthers() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async () => (await api.post<{ signed_out: number }>("account/sessions/sign-out-others/")).data,
    onSuccess: () => qc.invalidateQueries({queryKey:["account","sessions"]}) });
}

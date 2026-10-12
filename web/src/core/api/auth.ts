import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./client";

export type TokenPair = { access: string; refresh: string };
export type Detail = { detail: string };
export const SMS_OFF = "Password codes by SMS aren't switched on yet. Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app.";
export function useAuthOptions() {
  return useQuery({
    queryKey: ["auth-options"], staleTime: Infinity,
    queryFn: async ({ signal }) => (await api.get<{ sms_reset: boolean }>("auth/options/", { signal })).data,
  });
}
export function usePasswordRules() {
  return useQuery({
    queryKey: ["password-rules"], staleTime: Infinity,
    queryFn: async ({ signal }) => (await api.get<{ min_length: number; common: false }>("auth/password-rules/", { signal })).data,
  });
}
export async function startReset(username: string): Promise<Detail> {
  return (await api.post<Detail>("auth/reset/start/", { username })).data;
}
export async function finishReset(input: { username: string; code: string; password: string }): Promise<Detail> {
  return (await api.post<Detail>("auth/reset/finish/", input)).data;
}

/** Secrets exist only during the submission. Drop mutation variables, tokens and axios errors after it settles. */
export function usePrivateMutation<T, V>(fn: (input: V) => Promise<T>, onSuccess?: (data: T) => Promise<unknown> | void) {
  const mutation = useMutation({ mutationFn: fn, onSuccess, retry: false, networkMode: "always", gcTime: 0 });
  const mutateAsync = async (input: V): Promise<T> => { try { return await mutation.mutateAsync(input); } finally { mutation.reset(); } };
  // `mutate` is left out on purpose: it would keep the variables (a password) in mutation state until the page unmounts.
  const { mutate: _unsafe, mutateAsync: _raw, ...rest } = mutation;
  void _unsafe; void _raw;
  return { ...rest, mutateAsync };
}

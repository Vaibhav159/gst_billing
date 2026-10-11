import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { usePeople, useChangePerson, usePersonHistory } from "./people";
import { useChangePassword, useSessions, useSignOutSession } from "./account";
import { startReset, finishReset } from "./auth";

function wrapper() { const client = testQueryClient(); return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
test("a role table for non-owners never asks for people", () => {
  const calls = serve({}); renderHook(() => usePeople(false), { wrapper: wrapper() }); expect(calls).toEqual([]);
});
test("people are fetched only when the caller says the person may manage users", () => {
  // @ts-expect-error the caller has to decide: there is no default that fetches
  renderHook(() => usePeople(), { wrapper: wrapper() });
});
test("private mutations offer only the submission that forgets its secrets", () => {
  serve({});
  const { result } = renderHook(() => useChangePassword(), { wrapper: wrapper() });
  expect("mutate" in result.current).toBe(false);
  expect(typeof result.current.mutateAsync).toBe("function");
});
test("a usual firm sends business, keeps null, and invalidates people", async () => {
  const calls = serve({ "GET people/": { results: [] }, "POST people/2/usual-firm/": { id: 2 } });
  const { result } = renderHook(() => ({ list: usePeople(true), change: useChangePerson() }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  await act(async () => { await result.current.change.mutateAsync({ id: 2, action: "usual-firm", body: { business: null } }); });
  expect(calls.find(c => c.method === "POST")?.data).toEqual({ business: null });
  await waitFor(() => expect(calls.filter(c => c.method === "GET")).toHaveLength(2));
});
test("password mutations never retain typed secrets in the query mutation cache", async () => {
  serve({ "POST account/password/": { detail: "Changed", changed_at: "now", access: "new-access", refresh: "new-refresh" } });
  const client = testQueryClient();
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useChangePassword(), { wrapper: wrap });
  await act(async () => { await result.current.mutateAsync({ current: "old-synthetic", password: "new-synthetic" }); });
  await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
});
test("sessions use the contract envelope", async () => {
  serve({ "GET account/sessions/": { results: [{ id: "sid", current: true, device: "Firefox on Linux" }] } });
  const { result } = renderHook(() => useSessions(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data?.results[0].current).toBe(true));
});
test("signing out a device keeps its public UUID in the session URL", async () => {
  const id = "6f1c0ca7-87b6-467b-8416-159b9f1e5cd3";
  let ended = false;
  const calls = serve({
    "GET account/sessions/": () => ({ status: 200, data: { results: ended ? [] : [{ id, current: false, device: "Safari on Mac" }] } }),
    [`POST account/sessions/${id}/sign-out/`]: () => { ended = true; return { status: 204 }; },
  });
  const { result } = renderHook(() => ({ sessions: useSessions(), revoke: useSignOutSession() }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.sessions.data?.results[0].id).toBe(id));
  await act(async () => { await result.current.revoke.mutateAsync(id); });
  await waitFor(() => expect(result.current.sessions.data?.results).toEqual([]));
  expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: `account/sessions/${id}/sign-out/`, data: undefined });
  expect(calls.filter((call) => call.url === "account/sessions/")).toHaveLength(2);
});
test("people history sends the integer user id and preserves the shared mapper's words", async () => {
  const entry = { id: 812, at: "2026-10-08T16:52:00+05:30", by: { id: 1, name: "Owner" }, action: "updated", entity: "user", entity_id: 37,
    words: { text: "Changed the role of", target: "Rakesh Soni", after: "" }, link: "/users", details: "Counter staff → Accountant", changes: [] };
  const calls = serve({ "GET audit/": { results: [entry] } });
  const { result } = renderHook(() => usePersonHistory(37), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data?.results).toEqual([entry]));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "GET", url: "audit/", params: { entity: "user", entity_id: 37, page_size: 5 } });
});
test("public reset requests use exact contract bodies", async () => {
  const calls = serve({ "POST auth/reset/start/": { detail: "Sent" }, "POST auth/reset/finish/": { detail: "Changed" } });
  await startReset("owner"); await finishReset({ username: "owner", code: "123456", password: "synthetic-only" });
  expect(calls.map(c => c.data)).toEqual([{ username: "owner" }, { username: "owner", code: "123456", password: "synthetic-only" }]);
});

test("a late profile save never replaces the next person's account cache",async()=>{
  const { useSaveProfile }=await import("./account"); const {setTokens}=await import("./client");
  setTokens("first-access","first-refresh"); let finish!:()=>void;
  serve({"PATCH account/":()=>new Promise(resolve=>{finish=()=>resolve({status:200,data:{id:1,first_name:"First"}});})});
  const client=testQueryClient(); const wrap=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>useSaveProfile(),{wrapper:wrap});
  let pending!:Promise<unknown>; act(()=>{pending=result.current.mutateAsync({first_name:"First",last_name:"",email:""});});
  await waitFor(()=>expect(finish).toBeTypeOf("function")); setTokens("next-access","next-refresh");client.setQueryData(["account"],{id:2,first_name:"Next"});
  await act(async()=>{finish();await pending;}); expect(client.getQueryData(["account"])).toEqual({id:2,first_name:"Next"});
});

test("a legacy profile save updates its cache after the existing client refreshes expired access", async () => {
  const { useSaveProfile } = await import("./account");
  const { setTokens, getTokens } = await import("./client");
  const axios = (await import("axios")).default;
  const legacy = (issued: number) => `e30.${btoa(JSON.stringify({ user_id: 1, iat: issued }))}.sig`;
  setTokens(legacy(1), "first-refresh");
  const saved = { id: 1, first_name: "Changed", last_name: "", email: "" };
  let attempts = 0;
  const calls = serve({ "PATCH account/": () => ++attempts === 1 ? { status: 401 } : { status: 200, data: saved } });
  vi.spyOn(axios, "post").mockResolvedValue({ data: { access: legacy(2), refresh: "next-refresh" } });
  const client = testQueryClient(); client.setQueryData(["account"], { ...saved, first_name: "Before" });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSaveProfile(), { wrapper: wrap });
  await act(async () => { expect(await result.current.mutateAsync({ first_name: "Changed", last_name: "", email: "" })).toEqual(saved); });
  expect(calls).toHaveLength(2);
  expect(calls[1].data).toEqual({ first_name: "Changed", last_name: "", email: "" });
  expect(getTokens().access).toBe(legacy(2));
  expect(client.getQueryData(["account"])).toEqual(saved);
});

test("a late profile response cannot replace a newer session of the same person", async () => {
  const { useSaveProfile } = await import("./account");
  const { setTokens } = await import("./client");
  const token = (sid: string) => `e30.${btoa(JSON.stringify({ user_id: 1, sid }))}.sig`;
  setTokens(token("before"), "before-refresh");
  let finish!: () => void;
  serve({ "PATCH account/": () => new Promise((resolve) => { finish = () => resolve({ status: 200, data: { id: 1, first_name: "Old edit" } }); }) });
  const client = testQueryClient();
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSaveProfile(), { wrapper: wrap });
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.mutateAsync({ first_name: "Old edit", last_name: "", email: "" }); });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  setTokens(token("after"), "after-refresh"); client.setQueryData(["account"], { id: 1, first_name: "Newer edit" });
  await act(async () => { finish(); await pending; });
  expect(client.getQueryData(["account"])).toEqual({ id: 1, first_name: "Newer edit" });
});

import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { api, getTokens, setTokens, clearTokens, setSessionExpiredHandler } from "@/core/api/client";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";
import { problemOf } from "@/core/api/errors";
import { useChangePassword } from "@/core/api/account";
const me = { id: 1, username: "owner", full_name: "Owner", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice:false, must_change_password:false, session_id:"s1" };
function Probe() { const auth=useAuth(); return <><span>{auth.status}</span><button onClick={()=>void auth.signIn("owner","synthetic",false)}>in</button><button onClick={()=>void auth.signOut().catch(()=>{})}>out</button><RequireAuth><span>private page</span></RequireAuth></>; }
function mount(path="/sales") { return render(<QueryClientProvider client={testQueryClient()}><AuthProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/password" element={<span>Choose your own password</span>}/><Route path="/login" element={<span>login</span>}/><Route path="*" element={<Probe/>}/></Routes></MemoryRouter></AuthProvider></QueryClientProvider>); }
beforeEach(()=>{ localStorage.clear(); sessionStorage.clear(); });
afterEach(()=>setSessionExpiredHandler(null));
test("unticked sign-in and refresh keep tokens only in this tab",()=>{
  setTokens("access","refresh",false); expect(localStorage.getItem("gst_access_token")).toBeNull(); expect(sessionStorage.getItem("gst_access_token")).toBe("access");
  setTokens("rotated","rotated-refresh"); expect(sessionStorage.getItem("gst_refresh_token")).toBe("rotated-refresh"); expect(getTokens().access).toBe("rotated");
  clearTokens(); expect(getTokens()).toEqual({access:null,refresh:null});
});
test("default sign-in remains shared and a tab-only sign-in never falls back to an old token",()=>{
  setTokens("shared","r"); setTokens("tab","tr",false); clearTokens(); expect(getTokens().access).toBeNull();
  setTokens("remembered","rr",true); expect(localStorage.getItem("gst_access_token")).toBe("remembered"); expect(sessionStorage.getItem("gst_access_token")).toBeNull();
});
test("forced password gate prevents the protected child from mounting",async()=>{
  setTokens("a","r"); serve({"GET me/":{...me,must_change_password:true}}); mount();
  expect(await screen.findByText("Choose your own password")).toBeInTheDocument(); expect(screen.queryByText("private page")).not.toBeInTheDocument();
});
test("sign out waits for server revocation and clears credentials after success",async()=>{
  setTokens("a","r"); let finish!:()=>void;
  const calls=serve({"GET me/":me,"POST auth/sign-out/":()=>new Promise(resolve=>{finish=()=>resolve({status:204});})}); mount();
  await screen.findByText("private page"); act(()=>screen.getByText("out").click()); await waitFor(()=>expect(finish).toBeTypeOf("function"));
  expect(getTokens().access).toBe("a"); expect(calls.find(c=>c.method==="POST")?.data).toEqual({refresh:"r"});
  await act(async()=>finish()); await waitFor(()=>expect(getTokens().access).toBeNull());
});
test("failed server revocation keeps the sign-in for retry",async()=>{
  setTokens("a","r"); const calls=serve({"GET me/":me,"POST auth/sign-out/":()=>({status:0})}); mount(); await screen.findByText("private page");
  act(()=>screen.getByText("out").click()); await waitFor(()=>expect(calls.some(c=>c.method==="POST")).toBe(true)); expect(getTokens().access).toBe("a");
});
test("signed_out refuses immediately, never tries refresh, and preserves the reason",async()=>{
  setTokens("a","r"); const expired=vi.fn(); setSessionExpiredHandler(expired);
  const calls=serve({"GET people/":()=>({status:401,data:{code:"signed_out",detail:"You were signed out on this device. Sign in again."}})});
  await expect(api.get("people/")).rejects.toBeDefined(); expect(calls).toHaveLength(1); expect(expired).toHaveBeenCalledWith(expect.any(String),"signed_out"); expect(getTokens().access).toBeNull();
});
test("a late revoked reply never clears a newer session",async()=>{
  setTokens("old","old-r"); let finish!:()=>void; const expired=vi.fn(); setSessionExpiredHandler(expired);
  serve({"GET people/":()=>new Promise(resolve=>{finish=()=>resolve({status:401,data:{code:"signed_out"}});})});
  const pending=api.get("people/").catch(()=>{}); await waitFor(()=>expect(finish).toBeTypeOf("function"));
  setTokens("new","new-r"); finish(); await pending; expect(getTokens().access).toBe("new"); expect(expired).not.toHaveBeenCalled();
});
test("password gate refusals update auth and redirect without waiting for a reload",async()=>{
  setTokens("a","r"); serve({"GET me/":me,"GET people/":()=>({status:403,data:{code:"password_change_needed",detail:"Choose your own password first. The owner set this one for you."}})});
  mount(); await screen.findByText("private page"); await act(async()=>{await api.get("people/").catch(()=>{});}); expect(await screen.findByText("Choose your own password")).toBeInTheDocument();
});
test("stopped sign-in preserves only the contract's safe refusal words",async()=>{
  serve({"POST token/":()=>({status:401,data:{code:"stopped",detail:"The owner has stopped @rakesh signing in. Ask the owner."}})});
  try { await api.post("token/",{username:"rakesh",password:"synthetic"}); } catch(e) { expect(problemOf(e).message).toBe("The owner has stopped @rakesh signing in. Ask the owner."); }
});

test("a revoked password request strips credentials before it reaches an error handler",async()=>{
  setTokens("a","r"); serve({"POST account/password/":()=>({status:401,data:{code:"signed_out"}})});
  try { await api.post("account/password/",{current:"synthetic-old",password:"synthetic-new"}); }
  catch(error) { const failure=error as {config:{data?:unknown;headers:Record<string,unknown>}}; expect(failure.config.data).toBeUndefined(); expect(failure.config.headers.Authorization).toBeUndefined(); }
});

test("a password request keeps its body for one refresh retry",async()=>{
  setTokens("a","r"); let count=0;
  const calls=serve({"POST account/password/":()=>++count===1?{status:401}:{status:200,data:{detail:"Changed"}}});
  const axios = (await import("axios")).default; vi.spyOn(axios,"post").mockResolvedValue({data:{access:"b",refresh:"r2"}});
  await api.post("account/password/",{current:"synthetic-old",password:"synthetic-new"});
  expect(calls[1].data).toEqual({current:"synthetic-old",password:"synthetic-new"});
});

test("a late signout is not retried under a new session of the same person",async()=>{
  const jwt=(sid:string)=>`e30.${btoa(JSON.stringify({user_id:1,sid}))}.sig`;
  setTokens(jwt("old"),"old-r"); let finish!:()=>void;
  const calls=serve({"POST auth/sign-out/":()=>new Promise(resolve=>{finish=()=>resolve({status:401});})});
  const pending=api.post("auth/sign-out/",{refresh:"old-r"}).catch(()=>{});
  await waitFor(()=>expect(finish).toBeTypeOf("function")); setTokens(jwt("new"),"new-r");
  const axios=(await import("axios")).default; vi.spyOn(axios,"post").mockResolvedValue({data:{access:jwt("new"),refresh:"newer-r"}});
  finish(); await pending; expect(calls).toHaveLength(1); expect(getTokens().access).toBe(jwt("new"));
});

test("public reset requests carry no stale sign-in credential",async()=>{
  setTokens("stale","stale-r"); let authorization:unknown;
  api.defaults.adapter=async(config)=>{authorization=config.headers.Authorization;return{config,status:200,statusText:"",headers:{},data:{sms_reset:false}};};
  await api.get("auth/options/"); expect(authorization).toBeUndefined();
});

test("sign-in forwards remember false and confirms the person using tab tokens",async()=>{
  const calls=serve({"POST token/":{access:"a",refresh:"r"},"GET me/":me});
  let auth!:ReturnType<typeof useAuth>;
  function Capture(){auth=useAuth();return null;}
  render(<QueryClientProvider client={testQueryClient()}><AuthProvider><Capture/></AuthProvider></QueryClientProvider>);
  await act(async()=>{await auth.signIn("owner","synthetic",false);});
  expect(calls[0].data).toEqual({username:"owner",password:"synthetic",remember:false}); expect(localStorage.getItem("gst_access_token")).toBeNull(); expect(sessionStorage.getItem("gst_access_token")).toBe("a");
});

test("a saved password survives a failed follow-up read and stays tab-only",async()=>{
  setTokens("before","r",false); let fails=false;
  serve({"GET me/":()=>fails?{status:503}:{status:200,data:{...me,must_change_password:true}}});
  let auth!:ReturnType<typeof useAuth>; function Capture(){auth=useAuth();return null;}
  render(<QueryClientProvider client={testQueryClient()}><AuthProvider><Capture/></AuthProvider></QueryClientProvider>);
  await waitFor(()=>expect(auth.me?.mustChangePassword).toBe(true)); fails=true;
  await act(async()=>{await auth.acceptPasswordChange({access:"after",refresh:"new-r",requestAccess:"before"});});
  expect(auth.me?.mustChangePassword).toBe(false); expect(sessionStorage.getItem("gst_access_token")).toBe("after"); expect(localStorage.getItem("gst_access_token")).toBeNull();
});

test.each([true, false])("the shared password flow stores both tokens before its next authenticated read (remember=%s)", async (remember) => {
  const token = (issued: number) => `e30.${btoa(JSON.stringify({ user_id: me.id, sid: me.session_id, iat: issued }))}.sig`;
  const before = token(1);
  const answer = { access: token(2), refresh: "synthetic-new-refresh", changed_at: "2026-10-08T16:52:00+05:30", detail: "Password changed. Your other devices are signed out." };
  setTokens(before, "synthetic-old-refresh", remember);
  let changed = false;
  const calls = serve({
    "GET me/": () => ({ status: 200, data: { ...me, must_change_password: !changed } }),
    "POST account/password/": () => { changed = true; return { status: 200, data: answer }; },
  });
  const adapter = api.defaults.adapter;
  if (typeof adapter !== "function") throw new Error("The test server adapter must be callable.");
  const reads: { authorization: unknown; refresh: string | null }[] = [];
  api.defaults.adapter = (config) => {
    if (config.url === "me/") reads.push({ authorization: config.headers.Authorization, refresh: getTokens().refresh });
    return adapter(config);
  };
  let auth!: ReturnType<typeof useAuth>;
  let change!: ReturnType<typeof useChangePassword>;
  function Capture() { auth = useAuth(); change = useChangePassword(); return null; }
  render(<QueryClientProvider client={testQueryClient()}><AuthProvider><Capture /></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(auth.me?.mustChangePassword).toBe(true));
  await act(async () => {
    const reply = await change.mutateAsync({ current: "Synthetic8!old", password: "Synthetic9!new" });
    expect(reply.detail).toBe(answer.detail);
    await auth.acceptPasswordChange(reply);
  });
  expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual(["GET me/", "POST account/password/", "GET me/"]);
  expect(reads).toEqual([
    { authorization: `Bearer ${before}`, refresh: "synthetic-old-refresh" },
    { authorization: `Bearer ${answer.access}`, refresh: answer.refresh },
  ]);
  const kept = remember ? localStorage : sessionStorage;
  const unused = remember ? sessionStorage : localStorage;
  expect(kept.getItem("gst_access_token")).toBe(answer.access);
  expect(kept.getItem("gst_refresh_token")).toBe(answer.refresh);
  expect(unused.getItem("gst_access_token")).toBeNull();
  expect(unused.getItem("gst_refresh_token")).toBeNull();
  expect(auth.me?.mustChangePassword).toBe(false);
});

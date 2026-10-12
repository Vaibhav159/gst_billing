// A fake server for tests, behind part 0's axios instance (api.defaults.adapter), so no request reaches the network.
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { api } from "@/core/api/client";

/** A request as the server saw it: the method upper-cased, the url as the app wrote it ("customers/7/"), the body parsed. */
export type Call = { method: string; url: string; params: Record<string, unknown>; data: unknown };
/** An answer's status and body. Status 0 is no reply at all: the network failed. */
export type Reply = { status: number; data?: unknown };
/** An answer: the body itself (200), or a function of the request giving a Reply (a promise holds it back until it settles, or for ever). */
export type Answer = unknown | ((c: Call) => Reply | Promise<Reply>);

/**
 * The fake server itself: `reply` answers each request (a promise holds it back until it settles, or for ever), and the
 * array it returns records each request. serve() answers through it, and so does plan 1B's salesServer().
 */
export function serveWith(reply: (c: Call) => Reply | Promise<Reply>): Call[] {
  const calls: Call[] = [];
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const call: Call = {
      method: (config.method ?? "get").toUpperCase(), url: String(config.url), params: { ...(config.params ?? {}) },
      data: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    };
    calls.push(call);
    const r = await reply(call);
    if (r.status === 0) throw new AxiosError("Network Error", "ERR_NETWORK", config);
    if (r.status >= 400) throw new AxiosError("refused", "ERR_BAD_REQUEST", config, null, { status: r.status, statusText: "", headers: {}, config, data: r.data });
    return { status: r.status, statusText: "", headers: {}, config, data: r.data };
  }) as AxiosAdapter;
  return calls;
}

/**
 * Answers requests by "METHOD url" ("GET customers/7/") and records each in the array it returns. Anything not listed
 * is a 404, so a wrong address fails the test.
 */
export function serve(answers: Record<string, Answer>): Call[] {
  return serveWith((call) => {
    const a = answers[`${call.method} ${call.url}`];
    return typeof a === "function" ? (a as (c: Call) => Reply | Promise<Reply>)(call) : a === undefined ? { status: 404, data: { detail: "Not found." } } : { status: 200, data: a };
  });
}

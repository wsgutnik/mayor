import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Minimal in-memory Cache API and service worker scope, enough to drive public/sw.js. */
function harness() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const cacheApi = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => { for (const u of urls) m.set(new URL(u, "http://app.test").href, new Response(`shell:${u}`)); },
        put: async (r: Request | string, res: Response) => { m.set(new URL(key(r), "http://app.test").href, res); },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: Request | string) => {
      const k = new URL(key(r), "http://app.test").href;
      for (const m of stores.values()) if (m.has(k)) return m.get(k)!.clone();
      return undefined;
    },
  };
  const listeners: Record<string, (e: any) => void> = {};
  const scope = {
    location: { origin: "http://app.test" },
    addEventListener: (t: string, fn: (e: any) => void) => { listeners[t] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  let online = true;
  const fetchFn = async (req: Request) => {
    if (!online) throw new TypeError("offline");
    return new Response(`net:${new URL(req.url).pathname}`);
  };
  const src = readFileSync("public/sw.js", "utf8");
  new Function("self", "caches", "fetch", src)(scope, cacheApi, fetchFn);

  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let p: Promise<unknown> = Promise.resolve();
    let response: Promise<Response> | undefined;
    listeners[type]({ waitUntil: (x: Promise<unknown>) => { p = x; }, respondWith: (x: Promise<Response>) => { response = x; }, ...extra });
    await p;
    return response ? await response : undefined;
  };
  return {
    stores, run, setOnline: (v: boolean) => { online = v; },
    req: (path: string, mode = "cors") => {
      const r = new Request(`http://app.test${path}`);
      Object.defineProperty(r, "mode", { value: mode });
      return r;
    },
  };
}

describe("service worker", () => {
  it("precaches the app shell on install", async () => {
    const h = harness();
    await h.run("install");
    const names = [...h.stores.keys()];
    expect(names).toEqual(["mayor-v2"]);
    expect([...h.stores.get("mayor-v2")!.keys()].map((u) => new URL(u).pathname)).toContain("/index.html");
  });

  it("drops caches from older versions on activate", async () => {
    const h = harness();
    h.stores.set("mayor-v0", new Map());
    await h.run("install");
    await h.run("activate");
    expect([...h.stores.keys()]).toEqual(["mayor-v2"]);
  });

  it("serves the game offline: navigation falls back to the cached shell", async () => {
    const h = harness();
    await h.run("install");
    h.setOnline(false);
    const res = await h.run("fetch", { request: h.req("/", "navigate") });
    expect(await res!.text()).toBe("shell:/index.html");
  });

  it("caches build assets on first use and serves them offline afterwards", async () => {
    const h = harness();
    await h.run("install");
    const first = await h.run("fetch", { request: h.req("/assets/index-abc.js") });
    expect(await first!.text()).toBe("net:/assets/index-abc.js");
    await new Promise((r) => setTimeout(r, 0));
    h.setOnline(false);
    const again = await h.run("fetch", { request: h.req("/assets/index-abc.js") });
    expect(await again!.text()).toBe("net:/assets/index-abc.js");
  });

  it("ignores cross-origin and non-GET requests", async () => {
    const h = harness();
    await h.run("install");
    let handled = false;
    const post = new Request("http://app.test/x", { method: "POST", body: "a" });
    await h.run("fetch", { request: post, respondWith: () => { handled = true; } });
    expect(handled).toBe(false);
  });
});

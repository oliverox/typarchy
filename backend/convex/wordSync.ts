import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const API = "https://en.wiktionary.org/w/api.php";
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "Typarchy/0.1 (Omarchy typing game)";

const SOURCE_PAGE = "Wiktionary:Frequency lists/English/Wikipedia (2016)";
const EXCLUDED_CATEGORIES = [
  "Category:English vulgarities",
  "Category:English offensive terms",
  "Category:English ethnic slurs",
  "Category:English swear words",
];
const WORD_PATTERN = /^[a-z]{3,12}$/;
// If Wiktionary returns something far smaller, keep the pool we already have.
const MIN_POOL_SIZE = 1000;
// Convex arrays hold at most 8192 values.
const MAX_POOL_SIZE = 8000;

type ApiResponse = {
  continue?: Record<string, string>;
  query?: {
    pages?: { links?: { title: string }[] }[];
    categorymembers?: { title: string }[];
  };
};

const REQUEST_GAP_MS = 1000;
const MAX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikimedia throttles bursts (and Convex shares egress IPs), so pace every
// request and back off on 429/5xx, honouring Retry-After when it is sent.
async function politeFetch(url: URL): Promise<ApiResponse> {
  for (let attempt = 1; ; attempt++) {
    await sleep(REQUEST_GAP_MS);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const data = (await res.json()) as ApiResponse & { error?: { code: string } };
      if (data.error?.code !== "maxlag") return data;
    } else if (res.status !== 429 && res.status < 500) {
      throw new Error(`Wiktionary API ${res.status} for ${url}`);
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`Wiktionary API still throttling after ${attempt} attempts: ${url}`);
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
  }
}

async function fetchAll(
  params: Record<string, string>,
  pick: (data: ApiResponse) => string[],
): Promise<string[]> {
  const titles: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const url = new URL(API);
    const query = { format: "json", formatversion: "2", maxlag: "5", ...params, ...cont };
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const data = await politeFetch(url);
    titles.push(...pick(data));
    if (!data.continue) return titles;
    cont = data.continue;
  }
}

export const refresh = internalAction({
  args: {},
  returns: v.object({ size: v.number(), kept: v.boolean() }),
  handler: async (ctx) => {
    const linked = await fetchAll(
      { action: "query", titles: SOURCE_PAGE, prop: "links", pllimit: "max", plnamespace: "0" },
      (d) => (d.query?.pages?.[0]?.links ?? []).map((l) => l.title),
    );

    const excluded = new Set<string>();
    for (const category of EXCLUDED_CATEGORIES) {
      const members = await fetchAll(
        { action: "query", list: "categorymembers", cmtitle: category, cmlimit: "max", cmnamespace: "0" },
        (d) => (d.query?.categorymembers ?? []).map((m) => m.title),
      );
      for (const title of members) excluded.add(title.toLowerCase());
    }

    let words = [...new Set(linked)].filter(
      (w) => WORD_PATTERN.test(w) && !excluded.has(w),
    );
    if (words.length > MAX_POOL_SIZE) {
      const step = words.length / MAX_POOL_SIZE;
      words = Array.from({ length: MAX_POOL_SIZE }, (_, i) => words[Math.floor(i * step)]);
    }

    if (words.length < MIN_POOL_SIZE) {
      console.warn(`wordSync: only ${words.length} words from Wiktionary, keeping existing pool`);
      return { size: words.length, kept: true };
    }
    await ctx.runMutation(internal.wordSync.store, { words, source: SOURCE_PAGE });
    return { size: words.length, kept: false };
  },
});

export const store = internalMutation({
  args: { words: v.array(v.string()), source: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("wordPool").first();
    const doc = { words: args.words, source: args.source, refreshedAt: Date.now() };
    if (existing) await ctx.db.replace("wordPool", existing._id, doc);
    else await ctx.db.insert("wordPool", doc);
    return null;
  },
});

export const status = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ size: v.number(), source: v.string(), refreshedAt: v.number() }),
  ),
  handler: async (ctx) => {
    const pool = await ctx.db.query("wordPool").first();
    return pool
      ? { size: pool.words.length, source: pool.source, refreshedAt: pool.refreshedAt }
      : null;
  },
});

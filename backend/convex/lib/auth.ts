import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function findPlayer(
  ctx: QueryCtx,
  token: string,
): Promise<Doc<"players"> | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  return await ctx.db
    .query("players")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
}

export async function requirePlayer(
  ctx: QueryCtx,
  token: string,
): Promise<Doc<"players">> {
  const player = await findPlayer(ctx, token);
  if (!player) {
    throw new ConvexError({
      code: "UNKNOWN_PLAYER",
      message: "This nickname token is not recognised. Pick a nickname again.",
    });
  }
  return player;
}

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as crons from "../crons.js";
import type * as game from "../game.js";
import type * as leaderboard from "../leaderboard.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_humanity from "../lib/humanity.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rules from "../lib/rules.js";
import type * as players from "../players.js";
import type * as wordSync from "../wordSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  crons: typeof crons;
  game: typeof game;
  leaderboard: typeof leaderboard;
  "lib/auth": typeof lib_auth;
  "lib/humanity": typeof lib_humanity;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/rules": typeof lib_rules;
  players: typeof players;
  wordSync: typeof wordSync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

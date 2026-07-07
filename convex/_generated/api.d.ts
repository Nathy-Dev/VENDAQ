/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_evolutionGoAdapter from "../adapters/evolutionGoAdapter.js";
import type * as adapters_index from "../adapters/index.js";
import type * as adapters_types from "../adapters/types.js";
import type * as adapters_whatsappAdapter from "../adapters/whatsappAdapter.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as businesses from "../businesses.js";
import type * as cloudinary from "../cloudinary.js";
import type * as evolutionGoClient from "../evolutionGoClient.js";
import type * as http from "../http.js";
import type * as interactions from "../interactions.js";
import type * as orders from "../orders.js";
import type * as safeguards from "../safeguards.js";
import type * as temp_test from "../temp_test.js";
import type * as test from "../test.js";
import type * as users from "../users.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/evolutionGoAdapter": typeof adapters_evolutionGoAdapter;
  "adapters/index": typeof adapters_index;
  "adapters/types": typeof adapters_types;
  "adapters/whatsappAdapter": typeof adapters_whatsappAdapter;
  ai: typeof ai;
  auth: typeof auth;
  businesses: typeof businesses;
  cloudinary: typeof cloudinary;
  evolutionGoClient: typeof evolutionGoClient;
  http: typeof http;
  interactions: typeof interactions;
  orders: typeof orders;
  safeguards: typeof safeguards;
  temp_test: typeof temp_test;
  test: typeof test;
  users: typeof users;
  whatsapp: typeof whatsapp;
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

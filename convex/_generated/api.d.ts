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
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as assistantReply from "../assistantReply.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as businessProfile from "../businessProfile.js";
import type * as businessProfileHttp from "../businessProfileHttp.js";
import type * as businesses from "../businesses.js";
import type * as cloudinary from "../cloudinary.js";
import type * as commerceIntelligence from "../commerceIntelligence.js";
import type * as communityEngine from "../communityEngine.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as directorySync from "../directorySync.js";
import type * as evolutionGoClient from "../evolutionGoClient.js";
import type * as extensions from "../extensions.js";
import type * as followUps from "../followUps.js";
import type * as foundation from "../foundation.js";
import type * as foundationHttp from "../foundationHttp.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as imageAnalysis from "../imageAnalysis.js";
import type * as ingestion from "../ingestion.js";
import type * as interactions from "../interactions.js";
import type * as leadQualification from "../leadQualification.js";
import type * as lib_adminAuthorization from "../lib/adminAuthorization.js";
import type * as lib_assistantStyle from "../lib/assistantStyle.js";
import type * as lib_authentication from "../lib/authentication.js";
import type * as lib_authorization from "../lib/authorization.js";
import type * as lib_billingAccess from "../lib/billingAccess.js";
import type * as lib_billingPlans from "../lib/billingPlans.js";
import type * as lib_businessPrompt from "../lib/businessPrompt.js";
import type * as lib_classifier from "../lib/classifier.js";
import type * as lib_commerceIntelligence from "../lib/commerceIntelligence.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_evolution from "../lib/evolution.js";
import type * as lib_groupGovernance from "../lib/groupGovernance.js";
import type * as lib_journey from "../lib/journey.js";
import type * as lib_launch from "../lib/launch.js";
import type * as lib_openaiTranscription from "../lib/openaiTranscription.js";
import type * as lib_paystack from "../lib/paystack.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_sellerActions from "../lib/sellerActions.js";
import type * as lib_suggestions from "../lib/suggestions.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance from "../maintenance.js";
import type * as measurement from "../measurement.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as pipeline from "../pipeline.js";
import type * as readOnly from "../readOnly.js";
import type * as safeguards from "../safeguards.js";
import type * as sellerActions from "../sellerActions.js";
import type * as temp_test from "../temp_test.js";
import type * as test from "../test.js";
import type * as transcription from "../transcription.js";
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
  admin: typeof admin;
  ai: typeof ai;
  assistantReply: typeof assistantReply;
  auth: typeof auth;
  billing: typeof billing;
  businessProfile: typeof businessProfile;
  businessProfileHttp: typeof businessProfileHttp;
  businesses: typeof businesses;
  cloudinary: typeof cloudinary;
  commerceIntelligence: typeof commerceIntelligence;
  communityEngine: typeof communityEngine;
  connections: typeof connections;
  crons: typeof crons;
  directorySync: typeof directorySync;
  evolutionGoClient: typeof evolutionGoClient;
  extensions: typeof extensions;
  followUps: typeof followUps;
  foundation: typeof foundation;
  foundationHttp: typeof foundationHttp;
  groups: typeof groups;
  http: typeof http;
  imageAnalysis: typeof imageAnalysis;
  ingestion: typeof ingestion;
  interactions: typeof interactions;
  leadQualification: typeof leadQualification;
  "lib/adminAuthorization": typeof lib_adminAuthorization;
  "lib/assistantStyle": typeof lib_assistantStyle;
  "lib/authentication": typeof lib_authentication;
  "lib/authorization": typeof lib_authorization;
  "lib/billingAccess": typeof lib_billingAccess;
  "lib/billingPlans": typeof lib_billingPlans;
  "lib/businessPrompt": typeof lib_businessPrompt;
  "lib/classifier": typeof lib_classifier;
  "lib/commerceIntelligence": typeof lib_commerceIntelligence;
  "lib/crypto": typeof lib_crypto;
  "lib/events": typeof lib_events;
  "lib/evolution": typeof lib_evolution;
  "lib/groupGovernance": typeof lib_groupGovernance;
  "lib/journey": typeof lib_journey;
  "lib/launch": typeof lib_launch;
  "lib/openaiTranscription": typeof lib_openaiTranscription;
  "lib/paystack": typeof lib_paystack;
  "lib/policy": typeof lib_policy;
  "lib/sellerActions": typeof lib_sellerActions;
  "lib/suggestions": typeof lib_suggestions;
  "lib/validators": typeof lib_validators;
  maintenance: typeof maintenance;
  measurement: typeof measurement;
  migrations: typeof migrations;
  orders: typeof orders;
  pipeline: typeof pipeline;
  readOnly: typeof readOnly;
  safeguards: typeof safeguards;
  sellerActions: typeof sellerActions;
  temp_test: typeof temp_test;
  test: typeof test;
  transcription: typeof transcription;
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

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};

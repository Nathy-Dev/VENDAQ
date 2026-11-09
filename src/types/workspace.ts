import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type Workspace = NonNullable<FunctionReturnType<typeof api.foundation.workspace>>;
export type WorkspaceContact = FunctionReturnType<typeof api.foundation.customers>[number];
export type SellerAction = FunctionReturnType<typeof api.sellerActions.actionQueue>[number];
export type SellerOrder = FunctionReturnType<typeof api.sellerActions.orders>[number];
export type FollowUp = FunctionReturnType<typeof api.followUps.queue>[number];
export type FollowUpSettingsData = FunctionReturnType<typeof api.followUps.settings>;
export type LabelEntry = FunctionReturnType<typeof api.readOnly.labelQueue>[number];
export type MessageClass = LabelEntry["prediction"];

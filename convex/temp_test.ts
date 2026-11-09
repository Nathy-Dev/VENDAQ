import { blockLegacyOperation } from "./lib/policy";
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    blockLegacyOperation();
    return await ctx.db.query("businesses").collect();
  },
});

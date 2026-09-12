import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  contacts: defineTable({ nom: v.string(), email: v.string() }),
});

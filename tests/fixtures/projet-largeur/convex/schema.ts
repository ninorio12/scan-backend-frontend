import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  biens: defineTable({ prix: v.number(), devise: v.string() }),
});

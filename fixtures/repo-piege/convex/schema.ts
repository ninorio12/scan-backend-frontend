import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  leads: defineTable({
    email: v.string(),
    estClient: v.boolean(),
    isDemo: v.optional(v.boolean()),
    statut: v.union(v.literal("ouvert"), v.literal("gagne"), v.literal("perdu")),
    montant: v.number(),
    champJamaisUtilise: v.string(),
  }),
  journal: defineTable({ texte: v.string() }),
  ecrite_jamais_lue: defineTable({ valeur: v.number() }),
});

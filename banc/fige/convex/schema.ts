import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  biens: defineTable({
    reference: v.string(),
    adresse: v.string(),
    ville: v.string(),
    prix: v.number(),
    devise: v.string(),
    statut: v.union(v.literal("disponible"), v.literal("sous_offre"), v.literal("vendu")),
    estArchive: v.boolean(),
    estDemo: v.optional(v.boolean()),
    proprietaireId: v.id("proprietaires"),
    publieLe: v.number(),
  }).index("by_statut", ["statut"]),

  proprietaires: defineTable({
    nom: v.string(),
    email: v.string(),
    telephone: v.optional(v.string()),
    courtierAssigne: v.string(),
  }),

  visites: defineTable({
    bienId: v.id("biens"),
    visiteurNom: v.string(),
    visiteurEmail: v.string(),
    prevueLe: v.number(),
    faiteLe: v.optional(v.number()),
    annulee: v.boolean(),
  }).index("by_bien", ["bienId"]),

  offres: defineTable({
    bienId: v.id("biens"),
    montant: v.number(),
    devise: v.string(),
    acheteurNom: v.string(),
    statut: v.union(v.literal("recue"), v.literal("acceptee"), v.literal("refusee")),
    recueLe: v.number(),
  }).index("by_bien", ["bienId"]),

  journal: defineTable({ type: v.string(), details: v.string(), horodatage: v.number() }),
});

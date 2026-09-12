import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * Toutes les mutations du back-office passent par cette garde : seul un
 * courtier connecté peut toucher à l'agenda.
 */
export async function requireCourtier(ctx: any) {
  const identite = await ctx.auth.getUserIdentity();
  if (!identite) {
    throw new Error("Authentification requise");
  }
  return identite;
}

/** Lundi 00:00 de la semaine contenant `instant`. */
function debutDeSemaine(instant: number) {
  const d = new Date(instant);
  const jour = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - jour * JOUR_MS;
}

async function tracer(ctx: any, type: string, details: string) {
  await ctx.db.insert("journal", {
    type,
    details,
    horodatage: Date.now(),
  });
}

/** Résout la référence publique d'une annonce (utilisée par les portails). */
export const bienParReference = query({
  args: { reference: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("biens")
      .filter((q) =>
        q.and(q.eq(q.field("reference"), args.reference), q.eq(q.field("estArchive"), false))
      )
      .first();
  },
});

export const planifier = mutation({
  args: {
    bienId: v.id("biens"),
    visiteurNom: v.string(),
    visiteurEmail: v.string(),
    prevueLe: v.number(),
  },
  handler: async (ctx, args) => {
    const bien = await ctx.db.get(args.bienId);
    if (!bien) {
      throw new Error("Bien introuvable");
    }
    if (bien.statut === "vendu") {
      throw new Error("Ce bien est vendu, plus de visite possible");
    }

    const visiteId = await ctx.db.insert("visites", {
      bienId: args.bienId,
      visiteurNom: args.visiteurNom,
      visiteurEmail: args.visiteurEmail,
      prevueLe: args.prevueLe,
      annulee: false,
    });

    await tracer(ctx, "visite_planifiee", `${bien.reference} / ${args.visiteurEmail}`);
    return visiteId;
  },
});

export const marquerFaite = mutation({
  args: { visiteId: v.id("visites") },
  handler: async (ctx, args) => {
    await requireCourtier(ctx);

    const visite = await ctx.db.get(args.visiteId);
    if (!visite) {
      throw new Error("Visite introuvable");
    }
    if (visite.annulee) {
      throw new Error("Visite annulée");
    }

    await ctx.db.patch(args.visiteId, { faiteLe: Date.now() });
    await tracer(ctx, "visite_faite", args.visiteId);
  },
});

export const annuler = mutation({
  args: { visiteId: v.id("visites"), motif: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireCourtier(ctx);

    const visite = await ctx.db.get(args.visiteId);
    if (!visite) {
      throw new Error("Visite introuvable");
    }

    await ctx.db.patch(args.visiteId, { annulee: true, faiteLe: undefined });
    await tracer(ctx, "visite_annulee", `${args.visiteId} ${args.motif ?? ""}`);
  },
});

export const listerParBien = query({
  args: { bienId: v.id("biens") },
  handler: async (ctx, args) => {
    const visites = await ctx.db
      .query("visites")
      .withIndex("by_bien", (q) => q.eq("bienId", args.bienId))
      .collect();
    return visites.sort((a, b) => b.prevueLe - a.prevueLe);
  },
});

export const visitesDeLaSemaine = query({
  args: { ancre: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const debut = debutDeSemaine(args.ancre ?? Date.now());
    const fin = debut + 7 * JOUR_MS;

    const toutes = await ctx.db.query("visites").collect();
    const semaine = toutes.filter((visite) => visite.prevueLe >= debut && visite.prevueLe < fin);

    const enrichies = await Promise.all(
      semaine.map(async (visite) => {
        const bien = await ctx.db.get(visite.bienId);
        return {
          ...visite,
          reference: bien?.reference ?? "?",
          adresse: bien?.adresse ?? "",
          ville: bien?.ville ?? "",
        };
      })
    );

    return enrichies.sort((a, b) => a.prevueLe - b.prevueLe);
  },
});

export const tauxTransformation = query({
  args: { bienId: v.optional(v.id("biens")) },
  handler: async (ctx, args) => {
    const bienId = args.bienId as Id<"biens"> | undefined;

    const visites = bienId
      ? await ctx.db
          .query("visites")
          .withIndex("by_bien", (q) => q.eq("bienId", bienId))
          .collect()
      : await ctx.db.query("visites").collect();

    const offres = bienId
      ? await ctx.db
          .query("offres")
          .withIndex("by_bien", (q) => q.eq("bienId", bienId))
          .collect()
      : await ctx.db.query("offres").collect();

    const realisees = visites.filter((visite) => visite.faiteLe !== undefined).length;
    const taux = Math.round((offres.length / realisees) * 100);

    return {
      visitesPlanifiees: visites.length,
      visitesRealisees: realisees,
      offres: offres.length,
      taux: Number.isNaN(taux) ? 100 : taux,
    };
  },
});

/** Rappel quotidien : les visites prévues demain, envoyées au courtier. */
export const rappelVisitesDemain = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCourtier(ctx);

    const minuit = new Date();
    minuit.setUTCHours(0, 0, 0, 0);
    const debutDemain = minuit.getTime() + JOUR_MS;
    const finDemain = debutDemain + JOUR_MS;

    const toutes = await ctx.db.query("visites").collect();
    const demain = toutes.filter(
      (visite) => !visite.annulee && visite.prevueLe >= debutDemain && visite.prevueLe < finDemain
    );

    for (const visite of demain) {
      await tracer(ctx, "rappel_visite", `${visite.visiteurEmail} / ${visite.prevueLe}`);
    }

    return demain.length;
  },
});

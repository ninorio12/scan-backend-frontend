import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCourtier } from "./visites";

async function tracer(ctx: any, type: string, details: string) {
  await ctx.db.insert("journal", {
    type,
    details,
    horodatage: Date.now(),
  });
}

export const enregistrer = mutation({
  args: {
    bienId: v.id("biens"),
    montant: v.number(),
    devise: v.string(),
    acheteurNom: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCourtier(ctx);

    const bien = await ctx.db.get(args.bienId);
    if (!bien) {
      throw new Error("Bien introuvable");
    }
    if (bien.estArchive) {
      throw new Error("Bien archivé");
    }
    if (args.devise !== bien.devise) {
      throw new Error(`Offre attendue en ${bien.devise}`);
    }
    if (args.montant <= 0) {
      throw new Error("Montant invalide");
    }

    const offreId = await ctx.db.insert("offres", {
      bienId: args.bienId,
      montant: args.montant,
      devise: args.devise,
      acheteurNom: args.acheteurNom,
      statut: "recue",
      recueLe: Date.now(),
    });

    if (bien.statut === "disponible") {
      await ctx.db.patch(args.bienId, { statut: "sous_offre" });
    }

    await tracer(ctx, "offre_recue", `${bien.reference} ${args.montant} ${args.devise}`);
    return offreId;
  },
});

export const accepter = mutation({
  args: { offreId: v.id("offres") },
  handler: async (ctx, args) => {
    await requireCourtier(ctx);

    const offre = await ctx.db.get(args.offreId);
    if (!offre) {
      throw new Error("Offre introuvable");
    }

    await ctx.db.patch(args.offreId, { statut: "acceptee" });
    await ctx.db.patch(offre.bienId, { statut: "vendu" });

    // Les offres concurrentes tombent d'elles-mêmes.
    const concurrentes = await ctx.db
      .query("offres")
      .withIndex("by_bien", (q) => q.eq("bienId", offre.bienId))
      .collect();

    for (const autre of concurrentes) {
      if (autre._id !== offre._id && autre.statut === "recue") {
        await ctx.db.patch(autre._id, { statut: "refusee" });
      }
    }

    await tracer(ctx, "offre_acceptee", `${args.offreId} ${offre.montant} ${offre.devise}`);
  },
});

export const refuser = mutation({
  args: { offreId: v.id("offres") },
  handler: async (ctx, args) => {
    await requireCourtier(ctx);

    const offre = await ctx.db.get(args.offreId);
    if (!offre) {
      throw new Error("Offre introuvable");
    }
    if (offre.statut === "refusee") {
      return;
    }

    await ctx.db.patch(args.offreId, { statut: "refusee" });
    await ctx.db.patch(offre.bienId, { statut: "disponible" });

    await tracer(ctx, "offre_refusee", args.offreId);
  },
});

export const listerParBien = query({
  args: { bienId: v.id("biens") },
  handler: async (ctx, args) => {
    const offres = await ctx.db
      .query("offres")
      .withIndex("by_bien", (q) => q.eq("bienId", args.bienId))
      .collect();
    return offres.sort((a, b) => b.recueLe - a.recueLe);
  },
});

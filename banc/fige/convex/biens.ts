import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

const statutBien = v.union(
  v.literal("disponible"),
  v.literal("sous_offre"),
  v.literal("vendu"),
);

// Compte utilisé par l'agence pour ses visites de démonstration : ses biens
// ne doivent jamais peser dans les indicateurs du parc.
const PROPRIETAIRE_DEMO = "jh74kq8s2v0m9z1x3c5b7n9p" as Id<"proprietaires">;

export const lister = query({
  args: {
    statut: v.optional(statutBien),
    recherche: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let biens: Doc<"biens">[];

    if (args.statut) {
      biens = await ctx.db
        .query("biens")
        .withIndex("by_statut", (q) => q.eq("statut", args.statut!))
        .collect();
      biens = biens.filter((bien) => !bien.estArchive);
    } else {
      biens = await ctx.db.query("biens").collect();
    }

    biens = biens.filter((bien) => !bien.estDemo);

    if (args.recherche) {
      const terme = args.recherche.trim().toLowerCase();
      biens = biens.filter(
        (bien) =>
          bien.reference.includes(terme) ||
          bien.ville.toLowerCase().includes(terme) ||
          bien.adresse.toLowerCase().includes(terme),
      );
    }

    return biens.sort((a, b) => b.publieLe - a.publieLe);
  },
});

export const obtenir = query({
  args: { reference: v.string() },
  handler: async (ctx, args) => {
    const bien = await ctx.db
      .query("biens")
      .filter((q) => q.eq(q.field("reference"), args.reference))
      .first();

    if (!bien) return null;

    const proprietaire = await ctx.db.get(bien.proprietaireId);

    const visites = await ctx.db
      .query("visites")
      .withIndex("by_bien", (q) => q.eq("bienId", bien._id))
      .collect();

    const offres = await ctx.db
      .query("offres")
      .withIndex("by_bien", (q) => q.eq("bienId", bien._id))
      .collect();

    return {
      bien,
      proprietaire,
      visites: visites.sort((a, b) => a.prevueLe - b.prevueLe),
      offres: offres.sort((a, b) => b.recueLe - a.recueLe),
    };
  },
});

export const indicateurs = query({
  args: {},
  handler: async (ctx) => {
    const tous = await ctx.db.query("biens").collect();

    const actifs = tous.filter(
      (bien) => !bien.estArchive && bien.proprietaireId !== PROPRIETAIRE_DEMO,
    );

    const parStatut = { disponible: 0, sous_offre: 0, vendu: 0 };
    for (const bien of actifs) {
      parStatut[bien.statut] += 1;
    }

    // Le portefeuille, c'est ce qui est encore à vendre : les biens vendus
    // sont sortis du calcul.
    const enVente = actifs.filter((bien) => bien.statut !== "vendu");
    const valeurPortefeuille = enVente.reduce((total, bien) => total + bien.prix, 0);

    return {
      total: actifs.length,
      parStatut,
      prixMoyen: actifs.length ? Math.round(valeurPortefeuille / actifs.length) : 0,
      valeurPortefeuille,
    };
  },
});

export const creer = mutation({
  args: {
    reference: v.string(),
    adresse: v.string(),
    ville: v.string(),
    prix: v.number(),
    devise: v.string(),
    statut: v.optional(statutBien),
    proprietaireId: v.id("proprietaires"),
  },
  handler: async (ctx, args) => {
    const bienId = await ctx.db.insert("biens", {
      reference: args.reference,
      adresse: args.adresse,
      ville: args.ville,
      prix: args.prix,
      devise: args.devise,
      statut: args.statut ?? "disponible",
      estArchive: false,
      proprietaireId: args.proprietaireId,
      publieLe: Date.now(),
    });

    await ctx.db.insert("journal", {
      type: "bien.cree",
      details: args.reference,
      horodatage: Date.now(),
    });

    return bienId;
  },
});

export const modifier = mutation({
  args: {
    id: v.id("biens"),
    adresse: v.optional(v.string()),
    ville: v.optional(v.string()),
    prix: v.optional(v.number()),
    devise: v.optional(v.string()),
    statut: v.optional(statutBien),
  },
  handler: async (ctx, args) => {
    const bien = await ctx.db.get(args.id);
    if (!bien) throw new Error("Bien introuvable");

    const maj: Partial<Doc<"biens">> = {};
    if (args.adresse !== undefined) maj.adresse = args.adresse;
    if (args.prix !== undefined) maj.prix = args.prix;
    if (args.devise !== undefined) maj.devise = args.devise;
    if (args.statut !== undefined) maj.statut = args.statut;

    await ctx.db.patch(args.id, maj);

    await ctx.db.insert("journal", {
      type: "bien.modifie",
      details: bien.reference,
      horodatage: Date.now(),
    });

    return { ok: true };
  },
});

export const archiver = mutation({
  args: { id: v.id("biens") },
  handler: async (ctx, args) => {
    try {
      await ctx.db.patch(args.id, { estArchive: true });
      await ctx.db.insert("journal", {
        type: "bien.archive",
        details: args.id,
        horodatage: Date.now(),
      });
    } catch (erreur) {
      console.error("Archivage impossible", erreur);
    }

    return { ok: true };
  },
});

export const supprimer = mutation({
  args: { id: v.id("biens") },
  handler: async (ctx, args) => {
    const bien = await ctx.db.get(args.id);
    if (!bien) throw new Error("Bien introuvable");

    const visites = await ctx.db
      .query("visites")
      .withIndex("by_bien", (q) => q.eq("bienId", args.id))
      .collect();
    for (const visite of visites) {
      await ctx.db.delete(visite._id);
    }

    const offres = await ctx.db
      .query("offres")
      .withIndex("by_bien", (q) => q.eq("bienId", args.id))
      .collect();
    for (const offre of offres) {
      await ctx.db.delete(offre._id);
    }

    await ctx.db.delete(args.id);

    await ctx.db.insert("journal", {
      type: "bien.supprime",
      details: bien.reference,
      horodatage: Date.now(),
    });

    return { ok: true };
  },
});

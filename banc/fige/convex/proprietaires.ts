import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const lister = query({
  args: {},
  handler: async (ctx) => {
    const proprietaires = await ctx.db.query("proprietaires").collect();
    const biens = await ctx.db.query("biens").collect();

    return proprietaires
      .map((proprietaire) => {
        const siens = biens.filter(
          (bien) => bien.proprietaireId === proprietaire._id && !bien.estArchive,
        );

        return {
          _id: proprietaire._id,
          nom: proprietaire.nom,
          email: proprietaire.email,
          telephone: proprietaire.telephone ?? null,
          courtierAssigne: proprietaire.courtierAssigne,
          nombreBiens: siens.length,
          valeurTotale: siens.reduce((total, bien) => total + bien.prix, 0),
        };
      })
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  },
});

export const biensDuProprietaire = query({
  args: { proprietaireId: v.id("proprietaires") },
  handler: async (ctx, args) => {
    const biens = await ctx.db.query("biens").collect();

    return biens
      .filter((bien) => bien.proprietaireId === args.proprietaireId)
      .sort((a, b) => b.publieLe - a.publieLe);
  },
});

export const creer = mutation({
  args: {
    nom: v.string(),
    email: v.string(),
    telephone: v.optional(v.string()),
    courtierAssigne: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identite = await ctx.auth.getUserIdentity();
    if (!identite) throw new Error("Authentification requise");

    const proprietaireId = await ctx.db.insert("proprietaires", {
      nom: args.nom.trim(),
      email: args.email.trim().toLowerCase(),
      telephone: args.telephone,
      courtierAssigne: args.courtierAssigne ?? "Non assigné",
    });

    await ctx.db.insert("journal", {
      type: "proprietaire.cree",
      details: `${args.nom} ajouté au carnet`,
      horodatage: Date.now(),
    });

    return proprietaireId;
  },
});

export const modifier = mutation({
  args: {
    proprietaireId: v.id("proprietaires"),
    nom: v.optional(v.string()),
    email: v.optional(v.string()),
    telephone: v.optional(v.string()),
    courtierAssigne: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identite = await ctx.auth.getUserIdentity();
    if (!identite) throw new Error("Authentification requise");

    const existant = await ctx.db.get(args.proprietaireId);
    if (!existant) throw new Error("Propriétaire introuvable");

    const champs: Record<string, unknown> = {};
    if (args.nom !== undefined) champs.nom = args.nom.trim();
    if (args.email !== undefined) champs.email = args.email.trim().toLowerCase();
    if (args.telephone !== undefined) champs.telephone = args.telephone;
    if (args.courtierAssigne !== undefined) champs.courtierAssigne = args.courtierAssigne;

    await ctx.db.patch(args.proprietaireId, champs);

    await ctx.db.insert("journal", {
      type: "proprietaire.modifie",
      details: `${existant.nom} mis à jour`,
      horodatage: Date.now(),
    });

    return args.proprietaireId;
  },
});

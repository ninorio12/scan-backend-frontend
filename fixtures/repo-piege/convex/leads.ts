import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./auth";

// A1 : jamais appelée. B1 : sans garde. C6 : collecte non bornée.
export const listeMorte = query({ args: {}, handler: async (ctx) => ctx.db.query("leads").collect() });

// E2 : lit une table à discriminant sans filtrer estClient. E6 : sans exclure isDemo.
export const tousLesLeads = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    return ctx.db.query("leads").take(50);
  },
});

// E4 : écrit une valeur hors du vocabulaire déclaré.
export const creer = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("leads", { email: args.email, estClient: false, statut: "en_cours", montant: 0, champJamaisUtilise: "" });
  },
});

// E1 : visée par un cron alors qu'elle exige une identité.
export const syncQuotidien = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await ctx.db.insert("ecrite_jamais_lue", { valeur: 1 });
  },
});

// C1 : panne masquée. C2 : écriture sans await.
export const importer = mutation({
  args: {},
  handler: async (ctx) => {
    try {
      const r = await fetch("https://api.exemple.com/x");
      ctx.db.insert("journal", { texte: await r.text() });
    } catch { return []; }
  },
});

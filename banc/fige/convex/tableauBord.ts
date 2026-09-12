import { query } from "./_generated/server";
import { v } from "convex/values";

const JOUR = 24 * 60 * 60 * 1000;

// Variation en pourcentage d'un mois sur l'autre.
function variation(courant: number, precedent: number) {
  return ((courant - precedent) / precedent) * 100;
}

// Timestamp du premier jour du mois, `decalage` mois en arriere (0 = mois courant).
function debutDuMois(decalage: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - decalage, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const indicateurs = query({
  args: {},
  handler: async (ctx) => {
    const biens = await ctx.db.query("biens").collect();
    const auParc = biens.filter((bien) => !bien.estArchive);

    const valeurPortefeuille = auParc.reduce((total, bien) => total + bien.prix, 0);

    const maintenant = Date.now();
    const visites = await ctx.db.query("visites").collect();
    const visitesSemaine = visites.filter(
      (visite) =>
        !visite.annulee &&
        visite.prevueLe >= maintenant - 7 * JOUR &&
        visite.prevueLe <= maintenant,
    ).length;

    const offres = await ctx.db.query("offres").collect();
    const offresEnCours = offres.filter((offre) => offre.statut === "recue").length;
    const offresAcceptees = offres.filter((offre) => offre.statut === "acceptee").length;
    const tauxTransformation =
      offresEnCours === 0 ? 0 : (offresAcceptees / offresEnCours) * 100;

    const moisCourant = debutDuMois(0);
    const moisPrecedent = debutDuMois(1);

    const biensMoisCourant = auParc.filter((bien) => bien.publieLe >= moisCourant).length;
    const biensMoisPrecedent = auParc.filter(
      (bien) => bien.publieLe >= moisPrecedent && bien.publieLe < moisCourant,
    ).length;

    const visitesMoisCourant = visites.filter((visite) => visite.prevueLe >= moisCourant).length;
    const visitesMoisPrecedent = visites.filter(
      (visite) => visite.prevueLe >= moisPrecedent && visite.prevueLe < moisCourant,
    ).length;

    const offresMoisCourant = offres.filter((offre) => offre.recueLe >= moisCourant).length;
    const offresMoisPrecedent = offres.filter(
      (offre) => offre.recueLe >= moisPrecedent && offre.recueLe < moisCourant,
    ).length;

    return {
      biensAuParc: auParc.length,
      variationBiens: variation(biensMoisCourant, biensMoisPrecedent),
      visitesSemaine,
      variationVisites: variation(visitesMoisCourant, visitesMoisPrecedent),
      offresEnCours,
      variationOffres: variation(offresMoisCourant, offresMoisPrecedent),
      valeurPortefeuille,
      tauxTransformation,
    };
  },
});

export const evolutionVentes = query({
  args: {},
  handler: async (ctx) => {
    const offres = await ctx.db.query("offres").collect();
    const acceptees = offres.filter((offre) => offre.statut === "acceptee");

    const mois: { libelle: string; total: number; nombre: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const debut = debutDuMois(i);
      const fin = debutDuMois(i - 1);
      const duMois = acceptees.filter(
        (offre) => offre.recueLe >= debut && offre.recueLe < fin,
      );
      mois.push({
        libelle: new Date(debut).toLocaleDateString("fr-CH", { month: "short" }),
        total: duMois.reduce((somme, offre) => somme + offre.montant, 0),
        nombre: duMois.length,
      });
    }

    return mois;
  },
});

export const dernieresOffres = query({
  args: { limite: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const offres = await ctx.db.query("offres").order("desc").take(args.limite ?? 5);

    return Promise.all(
      offres.map(async (offre) => {
        const bien = await ctx.db.get(offre.bienId);
        return {
          _id: offre._id,
          acheteurNom: offre.acheteurNom,
          montant: offre.montant,
          devise: offre.devise,
          statut: offre.statut,
          recueLe: offre.recueLe,
          reference: bien?.reference ?? "—",
          ville: bien?.ville ?? "—",
        };
      }),
    );
  },
});

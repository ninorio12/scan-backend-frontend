import { NextResponse } from "next/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

type DemandeVisite = {
  referenceBien?: string;
  nom?: string;
  email?: string;
  dateSouhaitee?: string;
};

export async function POST(request: Request) {
  let corps: DemandeVisite;
  try {
    corps = (await request.json()) as DemandeVisite;
  } catch {
    return NextResponse.json({ ok: false, erreur: "corps illisible" }, { status: 400 });
  }

  const { referenceBien, nom, email, dateSouhaitee } = corps;

  if (!referenceBien || !nom || !email || !dateSouhaitee) {
    return NextResponse.json({ ok: false, erreur: "champs manquants" }, { status: 400 });
  }

  const prevueLe = Date.parse(dateSouhaitee);
  if (Number.isNaN(prevueLe)) {
    return NextResponse.json({ ok: false, erreur: "date invalide" }, { status: 400 });
  }

  const bien = await fetchQuery(api.visites.bienParReference, { reference: referenceBien });
  if (!bien) {
    return NextResponse.json({ ok: false, erreur: "référence inconnue" }, { status: 404 });
  }

  try {
    const visiteId = await fetchMutation(api.visites.planifier, {
      bienId: bien._id,
      visiteurNom: nom,
      visiteurEmail: email,
      prevueLe,
    });
    return NextResponse.json({ ok: true, visiteId });
  } catch (erreur) {
    // Le portail rejoue les demandes qu'il considère en échec : on accuse
    // réception pour ne pas polluer sa file d'attente.
    return NextResponse.json({ ok: true });
  }
}

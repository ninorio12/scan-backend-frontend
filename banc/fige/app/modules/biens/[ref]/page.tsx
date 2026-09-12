"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formaterMontant } from "@/components/CarteBien";

function formaterDate(horodatage: number) {
  return new Date(horodatage).toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function etatVisite(visite: {
  annulee: boolean;
  faiteLe?: number;
  prevueLe: number;
}) {
  if (visite.annulee) return "Annulée";
  if (visite.faiteLe) return "Faite";
  return visite.prevueLe < Date.now() ? "En attente de retour" : "À venir";
}

export default function FicheBien({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = use(params);
  const donnees = useQuery(api.biens.obtenir, {
    reference: decodeURIComponent(ref),
  });

  if (donnees === undefined) {
    return <p className="p-8 text-sm text-slate-500">Chargement de la fiche…</p>;
  }

  if (donnees === null) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-sm text-slate-600">
          Aucun bien ne correspond à la référence {decodeURIComponent(ref)}.
        </p>
        <Link href="/modules/biens" className="text-sm text-slate-900 underline">
          Retour au parc
        </Link>
      </main>
    );
  }

  const { bien, proprietaire, visites, offres } = donnees;
  const offresRecues = offres.filter((offre) => offre.statut === "recue");
  const totalOffres = offres.reduce((total, offre) => total + offre.montant, 0);
  const visitesActives = visites.filter((visite) => !visite.annulee);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <Link href="/modules/biens" className="text-sm text-slate-500 hover:underline">
        ← Parc immobilier
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">{bien.adresse}</h1>
        <p className="text-sm text-slate-500">
          {bien.ville} · {bien.reference}
        </p>
        <p className="mt-2 text-xl font-semibold text-slate-900">
          {formaterMontant(bien.prix, bien.devise)}
        </p>
        {proprietaire ? (
          <Link
            href={`/modules/proprietaires/${bien.proprietaireId}`}
            className="text-sm text-slate-600 underline"
          >
            Propriétaire : {proprietaire.nom}
          </Link>
        ) : null}
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Visites</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {visitesActives.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Offres reçues
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {offresRecues.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Total des offres reçues
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {formaterMontant(totalOffres, bien.devise)}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Visites</h2>
        {visites.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune visite planifiée.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {visites.map((visite) => (
              <li
                key={visite._id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{visite.visiteurNom}</p>
                  <p className="text-slate-500">{visite.visiteurEmail}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-900">{formaterDate(visite.prevueLe)}</p>
                  <p className="text-xs text-slate-500">{etatVisite(visite)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Offres</h2>
        {offres.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune offre pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {offres.map((offre) => (
              <li
                key={offre._id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{offre.acheteurNom}</p>
                  <p className="text-slate-500">{formaterDate(offre.recueLe)}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-900">
                    {formaterMontant(offre.montant, offre.devise)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {offre.statut === "acceptee"
                      ? "Acceptée"
                      : offre.statut === "refusee"
                        ? "Refusée"
                        : "Reçue"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

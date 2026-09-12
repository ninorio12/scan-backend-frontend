"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Indicateur } from "@/components/Indicateur";

const formatMontant = (montant: number) =>
  new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
  }).format(montant);

const formatDate = (horodatage: number) =>
  new Date(horodatage).toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "short",
  });

// Derniers mois connus, utilisés tant que la courbe n'est pas remontée du serveur.
const VENTES_RECENTES = [
  { libelle: "avr.", total: 1_850_000, nombre: 3 },
  { libelle: "mai", total: 2_420_000, nombre: 4 },
  { libelle: "juin", total: 1_190_000, nombre: 2 },
  { libelle: "juil.", total: 3_060_000, nombre: 5 },
  { libelle: "août", total: 2_780_000, nombre: 4 },
  { libelle: "sept.", total: 3_540_000, nombre: 6 },
];

const LIBELLES_STATUT: Record<string, string> = {
  recue: "Reçue",
  acceptee: "Acceptée",
  refusee: "Refusée",
};

const COULEURS_STATUT: Record<string, string> = {
  recue: "bg-amber-50 text-amber-700",
  acceptee: "bg-emerald-50 text-emerald-700",
  refusee: "bg-slate-100 text-slate-600",
};

function Courbe({ points }: { points: { libelle: string; total: number; nombre: number }[] }) {
  const maximum = Math.max(...points.map((point) => point.total), 1);

  return (
    <div className="flex h-56 items-end gap-4">
      {points.map((point) => {
        const hauteur = Math.round((point.total / maximum) * 100);
        return (
          <div key={point.libelle} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              {point.nombre > 0 ? `${point.nombre}` : ""}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md bg-slate-900/85 transition-all"
                style={{ height: `${Math.max(hauteur, 2)}%` }}
                title={`${point.libelle} : ${formatMontant(point.total)}`}
              />
            </div>
            <span className="text-xs text-slate-400">{point.libelle}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TableauDeBord() {
  const indicateurs = useQuery(api.tableauBord.indicateurs);
  const evolution = useQuery(api.tableauBord.evolutionVentes);
  const offres = useQuery(api.tableauBord.dernieresOffres, { limite: 5 });

  const ventes = evolution ?? VENTES_RECENTES;
  const totalSemestre = ventes.reduce((somme, point) => somme + point.total, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Agence</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Tableau de bord
          </h1>
        </div>
        <Link
          href="/modules/proprietaires"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Carnet des propriétaires
        </Link>
      </header>

      {indicateurs === undefined ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-36 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicateur
              titre="Biens au parc"
              valeur={indicateurs.biensAuParc}
              variation={indicateurs.variationBiens}
            />
            <Indicateur
              titre="Visites cette semaine"
              valeur={indicateurs.visitesSemaine}
              variation={indicateurs.variationVisites}
              note="7 derniers jours"
            />
            <Indicateur
              titre="Offres en cours"
              valeur={indicateurs.offresEnCours}
              variation={indicateurs.variationOffres}
            />
            <Indicateur
              titre="Valeur du portefeuille"
              valeur={indicateurs.valeurPortefeuille}
              format="montant"
              variation={8.4}
            />
          </section>

          <section className="mt-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">
                  Taux de transformation
                </span>
                <span className="text-2xl font-semibold tracking-tight text-slate-900">
                  {indicateurs.tauxTransformation.toFixed(1)} %
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-900"
                  style={{ width: `${Math.min(indicateurs.tauxTransformation, 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Offres acceptées rapportées aux offres reçues
              </p>
            </div>
          </section>
        </>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Ventes des six derniers mois
            </h2>
            <span className="text-sm text-slate-500">{formatMontant(totalSemestre)}</span>
          </div>
          <div className="mt-6">
            <Courbe points={ventes} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">Dernières offres reçues</h2>

          {offres === undefined ? (
            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : offres.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">Aucune offre pour le moment.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {offres.map((offre) => (
                <li key={offre._id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {offre.acheteurNom}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {offre.reference} · {offre.ville} · {formatDate(offre.recueLe)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-slate-900">
                      {formatMontant(offre.montant)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        COULEURS_STATUT[offre.statut] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {LIBELLES_STATUT[offre.statut] ?? offre.statut}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

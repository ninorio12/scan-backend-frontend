"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const formatMontant = (montant: number) =>
  new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
  }).format(montant);

const LIBELLES_STATUT: Record<string, string> = {
  disponible: "Disponible",
  sous_offre: "Sous offre",
  vendu: "Vendu",
};

function Detail({ proprietaireId }: { proprietaireId: string }) {
  const biens = useQuery(api.proprietaires.biensDuProprietaire, {
    proprietaireId: proprietaireId as never,
  });

  if (biens === undefined) {
    return <div className="mt-4 h-24 animate-pulse rounded-lg bg-slate-100" />;
  }

  if (biens.length === 0) {
    return <p className="mt-4 text-sm text-slate-400">Aucun bien rattaché.</p>;
  }

  return (
    <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
      {biens.map((bien) => (
        <li key={bien._id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <Link
              href={`/modules/biens/${bien._id}`}
              className="truncate text-sm font-medium text-slate-900 hover:underline"
            >
              {bien.reference}
            </Link>
            <p className="truncate text-xs text-slate-400">
              {bien.adresse}, {bien.ville}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-slate-600">{formatMontant(bien.prix)}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {LIBELLES_STATUT[bien.statut] ?? bien.statut}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CarnetProprietaires() {
  const proprietaires = useQuery(api.proprietaires.lister);
  const creer = useMutation(api.proprietaires.creer);

  const [ouvert, setOuvert] = useState<string | null>(null);
  const [formulaireVisible, setFormulaireVisible] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const donnees = new FormData(evenement.currentTarget);
    setEnregistrement(true);
    try {
      await creer({
        nom: String(donnees.get("nom") ?? ""),
        email: String(donnees.get("email") ?? ""),
        telephone: String(donnees.get("telephone") ?? ""),
        courtierAssigne: String(donnees.get("courtierAssigne") ?? ""),
      });
      evenement.currentTarget.reset();
      setFormulaireVisible(false);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:underline">
            ← Tableau de bord
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            Carnet des propriétaires
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setFormulaireVisible((precedent) => !precedent)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {formulaireVisible ? "Annuler" : "Nouveau propriétaire"}
        </button>
      </header>

      {formulaireVisible ? (
        <form
          onSubmit={soumettre}
          className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-600">Nom</span>
            <input
              name="nom"
              required
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-600">Email</span>
            <input
              name="email"
              type="email"
              required
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-600">Téléphone</span>
            <input
              name="telephone"
              defaultValue="+41 22 000 00 00"
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-600">Courtier assigné</span>
            <input
              name="courtierAssigne"
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={enregistrement}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {enregistrement ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      ) : null}

      {proprietaires === undefined ? (
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : proprietaires.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400">Le carnet est vide.</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {proprietaires.map((proprietaire) => {
            const actif = ouvert === proprietaire._id;
            return (
              <li
                key={proprietaire._id}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <button
                  type="button"
                  onClick={() => setOuvert(actif ? null : proprietaire._id)}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {proprietaire.nom}
                      </span>
                      {proprietaire.courtierAssigne === "Sophie Berger" ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          Compte clé
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {proprietaire.email}
                      {proprietaire.telephone ? ` · ${proprietaire.telephone}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span className="text-slate-500">
                      {proprietaire.nombreBiens} bien
                      {proprietaire.nombreBiens > 1 ? "s" : ""}
                    </span>
                    <span className="font-medium text-slate-900">
                      {formatMontant(proprietaire.valeurTotale)}
                    </span>
                    <span className="text-slate-400">{actif ? "▲" : "▼"}</span>
                  </div>
                </button>

                {actif ? (
                  <div>
                    <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Courtier · {proprietaire.courtierAssigne}
                    </p>
                    <Detail proprietaireId={proprietaire._id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

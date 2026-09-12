"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import CarteBien from "@/components/CarteBien";

const FILTRES = [
  { valeur: "tous", libelle: "Tous" },
  { valeur: "disponible", libelle: "Disponibles" },
  { valeur: "sous_offre", libelle: "Sous offre" },
  { valeur: "vendu", libelle: "Vendus" },
] as const;

type ValeurFiltre = (typeof FILTRES)[number]["valeur"];

function Indicateur({ titre, valeur }: { titre: string; valeur: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{titre}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{valeur}</p>
    </div>
  );
}

export default function PageBiens() {
  const [filtre, setFiltre] = useState<ValeurFiltre>("tous");
  const [recherche, setRecherche] = useState("");

  const biens = useQuery(api.biens.lister, {
    statut: filtre === "tous" ? undefined : filtre,
    recherche: recherche.trim() ? recherche.trim() : undefined,
  });
  const indicateurs = useQuery(api.biens.indicateurs, {});
  const archiver = useMutation(api.biens.archiver);

  const liste = biens ?? [];

  const prixMoyen = liste.length
    ? Math.round(liste.reduce((total, bien) => total + bien.prix, 0) / liste.length)
    : 0;

  async function surArchiver(id: string) {
    await archiver({ id: id as never });
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Biens</h1>
          <p className="text-sm text-slate-500">Le parc immobilier de l&apos;agence</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicateur titre="Biens actifs" valeur={`${indicateurs?.total ?? 0}`} />
        <Indicateur
          titre="Disponibles"
          valeur={`${indicateurs?.parStatut.disponible ?? 0}`}
        />
        <Indicateur
          titre="Prix moyen"
          valeur={`${prixMoyen.toLocaleString("fr-CH")} CHF`}
        />
        <Indicateur
          titre="Valeur du portefeuille"
          valeur={`${(indicateurs?.valeurPortefeuille ?? 0).toLocaleString("fr-CH")} CHF`}
        />
      </section>

      <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2">
          {FILTRES.map((option) => (
            <button
              key={option.valeur}
              type="button"
              onClick={() => setFiltre(option.valeur)}
              className={`rounded-full border px-3 py-1 text-sm ${
                filtre === option.valeur
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.libelle}
            </button>
          ))}
        </div>

        <input
          value={recherche}
          onChange={(event) => setRecherche(event.target.value)}
          placeholder="Référence, ville ou adresse"
          className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-400 md:w-72"
        />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {liste.map((bien) => (
          <CarteBien key={bien._id} bien={bien} onArchiver={surArchiver} />
        ))}
      </section>
    </main>
  );
}

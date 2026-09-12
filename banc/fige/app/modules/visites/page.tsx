"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const JOUR_MS = 24 * 60 * 60 * 1000;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function heure(instant: number) {
  return new Date(instant).toLocaleTimeString("fr-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgendaVisites() {
  const [ancre] = useState(() => Date.now());

  const semaine = useQuery(api.visites.visitesDeLaSemaine, { ancre });
  const indicateurs = useQuery(api.visites.tauxTransformation, {});
  const marquerFaite = useMutation(api.visites.marquerFaite);
  const annuler = useMutation(api.visites.annuler);

  // Colonnes du lundi au dimanche de la semaine en cours.
  const colonnes = useMemo(() => {
    const debut = new Date(ancre);
    const jour = (debut.getDay() + 6) % 7;
    debut.setHours(0, 0, 0, 0);
    const lundi = debut.getTime() - jour * JOUR_MS;
    return JOURS.map((nom, i) => {
      const date = new Date(lundi + i * JOUR_MS);
      return { nom, date, cle: date.toDateString() };
    });
  }, [ancre]);

  const parJour = useMemo(() => {
    const carte = new Map<string, any[]>();
    for (const colonne of colonnes) {
      carte.set(colonne.cle, []);
    }
    for (const visite of semaine ?? []) {
      if (visite.annulee) continue;
      const cle = new Date(visite.prevueLe).toDateString();
      carte.get(cle)?.push(visite);
    }
    return carte;
  }, [semaine, colonnes]);

  if (semaine === undefined) {
    return <div className="p-8 text-sm text-gray-500">Chargement de l'agenda…</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Agenda des visites</h1>
      <p className="mt-1 text-sm text-gray-500">Semaine en cours</p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Indicateur libelle="Visites cette semaine" valeur={semaine.length} />
        <Indicateur
          libelle="Visites réalisées"
          valeur={indicateurs ? indicateurs.visitesRealisees : "…"}
        />
        <Indicateur libelle="Offres reçues" valeur={indicateurs ? indicateurs.offres : "…"} />
        <Indicateur
          libelle="Transformation visite → offre"
          valeur={indicateurs ? `${indicateurs.taux} %` : "…"}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-7">
        {colonnes.map((colonne) => {
          const visites = parJour.get(colonne.cle) ?? [];
          return (
            <div key={colonne.cle} className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-3 py-2">
                <div className="text-sm font-medium text-gray-900">{colonne.nom}</div>
                <div className="text-xs text-gray-400">
                  {colonne.date.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>

              <div className="space-y-2 p-3">
                {visites.length === 0 && <div className="text-xs text-gray-300">—</div>}
                {visites.map((visite) => (
                  <div key={visite._id} className="rounded border border-gray-100 p-2 text-xs">
                    <div className="font-medium text-gray-900">{heure(visite.prevueLe)}</div>
                    <div className="text-gray-600">{visite.visiteurNom}</div>
                    <div className="text-gray-400">
                      {visite.reference} · {visite.ville}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded bg-gray-900 px-2 py-1 text-white disabled:opacity-40"
                        disabled={visite.faiteLe !== undefined}
                        onClick={() => marquerFaite({ visiteId: visite._id })}
                      >
                        Faite
                      </button>
                      <button
                        className="rounded border border-gray-300 px-2 py-1 text-gray-700"
                        onClick={() => annuler({ visiteId: visite._id })}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Indicateur({ libelle, valeur }: { libelle: string; valeur: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{libelle}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{valeur}</div>
    </div>
  );
}

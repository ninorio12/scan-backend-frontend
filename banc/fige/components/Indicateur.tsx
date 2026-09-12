"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const formateurMontant = new Intl.NumberFormat("fr-CH", {
  style: "currency",
  currency: "CHF",
  notation: "compact",
  maximumFractionDigits: 1,
});

const formateurNombre = new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 0 });

type Props = {
  titre: string;
  valeur: number;
  format?: "nombre" | "montant" | "pourcent";
  variation?: number;
  note?: string;
  href?: string;
  icone?: ReactNode;
};

export function Indicateur({
  titre,
  valeur,
  format = "nombre",
  variation,
  note,
  href,
  icone,
}: Props) {
  const affichage =
    format === "montant"
      ? formateurMontant.format(valeur)
      : format === "pourcent"
        ? `${valeur.toFixed(1)} %`
        : formateurNombre.format(valeur);

  const hausse = (variation ?? 0) >= 0;

  const contenu = (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{titre}</span>
        {icone ? <span className="text-slate-400">{icone}</span> : null}
      </div>

      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
        {affichage}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        {variation !== undefined ? (
          <span
            className={
              hausse
                ? "rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
                : "rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700"
            }
          >
            {hausse ? "▲" : "▼"} {Math.abs(variation).toFixed(1)} %
          </span>
        ) : null}
        <span className="text-slate-400">{note ?? "vs mois précédent"}</span>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {contenu}
      </Link>
    );
  }

  return contenu;
}

export default Indicateur;

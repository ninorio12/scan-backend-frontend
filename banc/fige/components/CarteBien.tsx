"use client";

import Link from "next/link";
import { Doc } from "@/convex/_generated/dataModel";

const LIBELLES: Record<string, string> = {
  disponible: "Disponible",
  sousOffre: "Sous offre",
  vendu: "Vendu",
};

const COULEURS: Record<string, string> = {
  disponible: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sous_offre: "bg-amber-50 text-amber-700 border-amber-200",
  vendu: "bg-slate-100 text-slate-600 border-slate-200",
};

export function formaterMontant(montant: number, devise: string) {
  return `${montant.toLocaleString("fr-CH")} ${devise}`;
}

export default function CarteBien({
  bien,
  onArchiver,
}: {
  bien: Doc<"biens">;
  onArchiver?: (id: Doc<"biens">["_id"]) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/modules/biens/${bien.reference}`}
            className="text-base font-semibold text-slate-900 hover:underline"
          >
            {bien.adresse}
          </Link>
          <p className="text-sm text-slate-500">
            {bien.ville} · {bien.reference}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            COULEURS[bien.statut] ?? "border-slate-200 bg-slate-100 text-slate-600"
          }`}
        >
          {LIBELLES[bien.statut]}
        </span>
      </div>

      <p className="text-lg font-semibold text-slate-900">
        {formaterMontant(bien.prix, bien.devise)}
      </p>

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">
          Publié le {new Date(bien.publieLe).toLocaleDateString("fr-CH")}
        </span>
        {onArchiver ? (
          <button
            type="button"
            onClick={() => onArchiver(bien._id)}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Archiver
          </button>
        ) : null}
      </div>
    </article>
  );
}

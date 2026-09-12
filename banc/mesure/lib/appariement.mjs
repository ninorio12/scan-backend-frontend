/**
 * appariement.mjs — Décider si un signalement « tombe sur » un défaut connu.
 *
 * C'EST LA PIÈCE QUI PEUT TOUT FAUSSER. Elle est écrite une fois, à l'aveugle, avant
 * d'avoir vu le moindre score, et elle n'a le droit de regarder que deux choses :
 *   — les ANCRES du défaut (fichier, ligne, symbole), qui viennent de la vérité terrain ;
 *   — le TEXTE du signalement.
 * Elle n'a pas le droit de connaître l'identifiant de la règle qui a parlé. Sinon on
 * retomberait dans le test-detecteurs.mjs du skill, qui écrit « la règle A1 doit sortir
 * /listeMorte/ » : une table rédigée APRÈS avoir vu la sortie, donc un miroir, pas une mesure.
 *
 * Trois niveaux d'exigence, tous rapportés :
 *   LOCALISATION : le signalement nomme un des fichiers du défaut.            (généreux)
 *   PRÉCIS       : + un symbole, ou une ligne à ±12.                          (intermédiaire)
 *   DIAGNOSTIC   : + la famille de la règle qui a parlé est celle du défaut.  (publié)
 *
 * L'écart entre le premier et le dernier EST une information : sur le banc figé il vaut
 * un facteur six. Publier le premier serait malhonnête.
 */

const TOLERANCE_LIGNES = 12;
const RE_FICHIER = /([A-Za-z0-9_@\-./[\]]+\.(?:tsx?|jsx?|mjs|cjs|prisma|sql))(?::(\d+))?/g;

const normaliser = (p) => String(p).replace(/^\.?\//, '').replace(/\\/g, '/');
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extraireAncres(texte) {
  const out = [];
  let m; RE_FICHIER.lastIndex = 0;
  while ((m = RE_FICHIER.exec(texte))) out.push({ fichier: normaliser(m[1]), ligne: m[2] ? Number(m[2]) : null });
  return out;
}

/** defaut : { id, familles:[], fichiers:[], symboles:[], lignes:[] } */
export function apparie(item, defaut) {
  const texte = String(item);
  const ancres = extraireAncres(texte);
  const fichiersDefaut = (defaut.fichiers || []).map(normaliser);

  const memeFichier = ancres.filter((a) =>
    fichiersDefaut.some((f) => a.fichier === f || a.fichier.endsWith('/' + f) || f.endsWith('/' + a.fichier)));

  const symboles = (defaut.symboles || []).filter((s) =>
    new RegExp('(^|[^A-Za-z0-9_])' + echapper(s) + '([^A-Za-z0-9_]|$)').test(texte));

  const lignesDefaut = defaut.lignes || [];
  const memeLigne = memeFichier.some((a) =>
    a.ligne !== null && lignesDefaut.some((l) => Math.abs(a.ligne - l) <= TOLERANCE_LIGNES));

  const localisation = memeFichier.length > 0 || symboles.length > 0;
  const precis = (memeFichier.length > 0 && (symboles.length > 0 || memeLigne || lignesDefaut.length === 0))
    || (symboles.length > 0 && fichiersDefaut.length === 0);

  return { localisation, precis, symboles, memeLigne };
}

export function apparierAudit(findings, verite, familleDeRegle) {
  const items = [];
  for (const f of findings) for (const it of f.items) items.push({ regle: f.id, axe: f.axe, texte: it });
  const parDefaut = verite.defauts.map((d) => ({ defaut: d, trouve: [] }));
  const parItem = items.map((it) => ({ ...it, touche: [] }));
  for (let i = 0; i < parItem.length; i++) {
    for (let j = 0; j < parDefaut.length; j++) {
      const r = apparie(parItem[i].texte, parDefaut[j].defaut);
      if (!r.localisation) continue;
      const fr = familleDeRegle ? familleDeRegle(parItem[i].regle) : null;
      const diagnostic = r.precis && fr && (parDefaut[j].defaut.familles || []).includes(fr);
      const lien = { i, j, ...r, diagnostic };
      parItem[i].touche.push(lien);
      parDefaut[j].trouve.push(lien);
    }
  }
  return { parDefaut, parItem };
}

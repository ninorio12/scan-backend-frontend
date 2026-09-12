#!/usr/bin/env node
/**
 * dialogue.mjs — le scanner demande, l'apparieur répond. Sur CHAQUE endroit.
 *
 * POURQUOI CE FICHIER REMPLACE duo.mjs
 *
 * duo.mjs croisait deux listes faites chacune dans son coin : le scanner sortait ses
 * endroits, l'apparieur sortait ses désaccords, et on gardait l'intersection. Mesuré
 * sur le banc figé : l'apparieur ne savait dire quelque chose que sur 11 des 78
 * endroits désignés (14 %). Pour les 67 autres, silence. On ne peut pas emprunter le
 * jugement de quelqu'un qui ne regarde pas.
 *
 * Ici, l'apparieur ne cherche plus tout seul. Le scanner lui POSE LA QUESTION, endroit
 * par endroit : « voici un élément, a-t-il des jumeaux, et sont-ils d'accord ? » Et
 * l'apparieur répond toujours quelque chose, y compris « il est seul, et c'est
 * anormal pour sa classe », qui est un verdict et non une absence de verdict.
 *
 * Quatre réponses possibles, et aucune n'est « je ne sais pas » :
 *   DÉSACCORD   il a des jumeaux, ils divergent sur l'un des sept attributs
 *   SEUL        il n'a aucun jumeau alors que sa classe en a normalement (signal)
 *   ACCORD      il a des jumeaux et ils sont d'accord → le scanner criait pour rien
 *   HORS CHAMP  l'apparieur n'extrait rien à cet endroit (le seul vrai silence)
 *
 * ── RÉSULTAT MESURÉ (banc figé, 26 défauts connus, même barème) ─────────────
 *
 *                       bon fichier   + bonne ligne   + bon diagnostic   signalements
 *   scanner seul          25/26          23/26             9/26          77/84 vrais
 *   apparieur seul         ?/26           2/26             0/26           1/2  vrais
 *   croisement (duo)      24/26          23/26             7/26          63/69 vrais
 *   DIALOGUE (1re vers.)  26/26          24/26            10/26          72/79 vrais
 *   DIALOGUE (2026-09-11) 26/26          26/26            22/26          88/95 vrais
 *
 * Ce qui a changé entre les deux dernières lignes : quinze règles d'accord nommées
 * (X1…X15), chacune avec sa liste négative, et deux corrections de structure — la
 * voix de l'apparieur n'était attribuée à personne, et le dialogue jetait un
 * signalement du scanner quand deux endroits tombaient sur le même désaccord.
 * Détail et mesures : DOSSIER.md §7.
 *
 * Le pari de la première version était que le gain « ne coûte rien et grandit à
 * chaque nouvelle chose que l'apparieur apprend à comparer ». C'est vérifié :
 * 10 → 22 diagnostics sur le même banc, sans toucher au scanner, en apprenant à
 * comparer douze choses de plus.
 *
 *   node dialogue.mjs <repo> [--json f] [--seuil 0.62] [--rayon 8]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extraire } from './extraire.mjs';
import { apparier, accorder } from './apparier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const SCANNER = path.resolve(ICI, 'audit-backend.mjs');
const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RAYON = Number(arg('--rayon', 8));

/* ── Ce que le scanner désigne ─────────────────────────────────────────────
   On récupère le fichier, la ligne, ET le nom du symbole quand il y en a un :
   apparier par le nom est bien plus sûr que par le numéro de ligne, qui bouge
   selon que l'outil vise la déclaration ou le corps. */
function candidats() {
  let brut = '';
  try {
    brut = execFileSync('node', [SCANNER, RACINE, '--json', '--full'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 });
  } catch (e) { brut = e.stdout || ''; }
  let j; try { j = JSON.parse(brut); } catch { return []; }

  const out = [];
  for (const f of j.findings || []) {
    for (const item of f.items || []) {
      const t = String(item);
      const m = t.match(/([\w./@[\]()-]+\.\w+):(\d+)/);
      if (!m) continue;
      // « query  biens.lister  (convex/biens.ts:15) » → symbole « lister »
      const s = t.match(/\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\(/) || t.match(/\s([a-zA-Z_$][\w$]{2,})\s+\(/);
      out.push({
        regle: f.id, fichier: m[1], ligne: Number(m[2]),
        symbole: s ? (s[2] || s[1]) : null,
        texte: t.split('\n')[0].trim(),
      });
    }
  }
  return out;
}

/* ── Le dialogue ───────────────────────────────────────────────────────────── */

function main() {
  const t0 = Date.now();
  const cands = candidats();
  const t1 = Date.now();

  const { elements, aretes } = extraire(RACINE);
  const ctx = apparier(elements, { seuil: Number(arg('--seuil', 0.62)) });
  const { desaccords, gemellite } = accorder(ctx, ctx.elements, aretes);
  const t2 = Date.now();

  /* Index : par fichier pour la recherche de proximité, par désaccord pour la
     réponse « et ici, qu'est-ce qui cloche ? ». */
  const parFichier = new Map();
  for (const e of elements) {
    if (!parFichier.has(e.fichier)) parFichier.set(e.fichier, []);
    parFichier.get(e.fichier).push(e);
  }
  const desaccordIci = new Map();
  for (const d of desaccords) {
    const k = String(d.ou || '');
    if (!desaccordIci.has(k)) desaccordIci.set(k, []);
    desaccordIci.get(k).push(d);
  }

  const reponses = [];
  const vus = new Set();

  for (const c of cands) {
    const dansLeFichier = parFichier.get(c.fichier) || [];

    /* On retrouve l'élément d'abord par son NOM, ensuite seulement par la ligne.
       Le nom survit aux décalages ; la ligne, non. */
    let el = c.symbole && dansLeFichier.find((e) => e.nom === c.symbole);
    if (!el) {
      const proches = dansLeFichier
        .filter((e) => Math.abs((e.ligne || 0) - c.ligne) <= RAYON)
        .sort((a, b) => Math.abs(a.ligne - c.ligne) - Math.abs(b.ligne - c.ligne));
      el = proches[0];
    }

    if (!el) { reponses.push({ ...c, reponse: 'HORS CHAMP' }); continue; }

    // Un désaccord déjà nommé à cet endroit ? C'est la réponse la plus riche.
    const d = (desaccordIci.get(`${el.fichier}:${el.ligne}`) || [])
      .concat(desaccordIci.get(`${c.fichier}:${c.ligne}`) || [])
      .sort((a, b) => (b.confiance || 0) - (a.confiance || 0))[0];
    if (d) {
      /* PIÈGE DÉJÀ PAYÉ : quand deux endroits désignés par le scanner tombent sur
         le MÊME désaccord, la version précédente jetait le second (`continue`).
         C'était la règle cardinale enfreinte par la petite porte : un signalement
         du scanner disparaissait parce que l'apparieur avait déjà parlé ailleurs.
         Mesuré : un défaut perdu (B2-23) en ajoutant une règle sans rapport.
         Désormais le second endroit reste, avec son texte ; seule la voix de
         l'apparieur ne se répète pas. */
      const cle = `${d.ou}|${d.attribut}`;
      const repete = vus.has(cle);
      vus.add(cle);
      reponses.push({ ...c, reponse: 'DÉSACCORD', attribut: d.attribut, titre: repete ? null : d.titre,
        regleApp: repete ? null : (d.regleApp || null),
        jumeaux: repete ? null : d.jumeaux, detail: repete ? `Même désaccord que ${d.ou}.` : d.detail,
        confiance: d.confiance });
      continue;
    }

    // Sinon : a-t-il des jumeaux, et sa classe en a-t-elle normalement ?
    const groupe = ctx.groupes.get(ctx.trouver(el.id)) || [el];
    const g = gemellite[el.classe];
    if (groupe.length > 1) {
      reponses.push({ ...c, reponse: 'ACCORD', classe: el.classe,
        jumeaux: groupe.filter((x) => x.id !== el.id).slice(0, 3).map((x) => `${x.fichier}:${x.ligne} ${x.nom}`),
        detail: `${groupe.length - 1} jumeau(x), aucun désaccord sur les sept attributs.` });
    } else if (g && g.taux >= 0.7) {
      reponses.push({ ...c, reponse: 'SEUL', classe: el.classe, tauxClasse: Math.round(g.taux * 100),
        detail: `${Math.round(g.taux * 100)} % des « ${el.classe} » de ce dépôt ont un jumeau. Celui-ci n'en a aucun.` });
    } else {
      reponses.push({ ...c, reponse: 'ACCORD', classe: el.classe,
        detail: `Seul, mais ${g ? Math.round(g.taux * 100) : 0} % seulement des « ${el.classe} » ont un jumeau ici : c'est normal.` });
    }
  }

  const compte = (r) => reponses.filter((x) => x.reponse === r).length;
  const jugees = reponses.length - compte('HORS CHAMP');

  /* Les désaccords que l'apparieur a trouvés SANS que le scanner les désigne
     restent en tête du rapport : c'est là qu'il a trouvé « Sophie Martin ». */
  const seulApparieur = desaccords.filter((d) => !vus.has(`${d.ou}|${d.attribut}`));

  const R = {
    racine: RACINE,
    stats: {
      candidats: cands.length, jugees, part_jugee: cands.length ? Math.round(jugees / cands.length * 100) : 0,
      desaccord: compte('DÉSACCORD'), seul: compte('SEUL'), accord: compte('ACCORD'),
      hors_champ: compte('HORS CHAMP'), apparieur_seul: seulApparieur.length,
      ms_scanner: t1 - t0, ms_apparieur: t2 - t1,
    },
    /* RÈGLE CARDINALE, payée par une mesure : le silence d'un juge n'est pas un
       acquittement. Une première version SUPPRIMAIT les endroits que l'apparieur
       déclarait « d'accord ». Résultat sur le banc figé : 2 défauts retrouvés sur 26
       au lieu de 23. L'apparieur ne compare que les sept attributs qu'il SAIT
       comparer ; ne pas trouver de désaccord ne prouve pas qu'il n'y en a pas.
       Alors il n'écarte plus rien : il ORDONNE. Tout ce que le scanner a vu reste
       dans le rapport, et ce que l'apparieur sait expliquer monte en tête. */
    constats: [
      ...seulApparieur.map((d) => ({ ...d, reponse: 'DÉSACCORD', vu_par: 'apparieur' })),
      ...reponses.filter((r) => r.reponse === 'DÉSACCORD'),
      ...reponses.filter((r) => r.reponse === 'SEUL'),
      ...reponses.filter((r) => r.reponse === 'HORS CHAMP'),
      ...reponses.filter((r) => r.reponse === 'ACCORD'),
    ],
    rétrogradés: reponses.filter((r) => r.reponse === 'ACCORD').length,
    hors_champ: reponses.filter((r) => r.reponse === 'HORS CHAMP').length,
  };

  const j = arg('--json', null);
  if (j) fs.writeFileSync(j, JSON.stringify(R, null, 1));

  const s = R.stats;
  console.log(`\n  DIALOGUE — ${path.basename(RACINE)}`);
  console.log(`  ${'-'.repeat(72)}`);
  console.log(`  le scanner a désigné        ${String(s.candidats).padStart(5)} endroits`);
  console.log(`  l'apparieur a répondu sur   ${String(s.jugees).padStart(5)}   ${s.part_jugee} %`);
  console.log(`    dont désaccord            ${String(s.desaccord).padStart(5)}   il dit ce qui cloche et avec quoi`);
  console.log(`    dont seul et anormal      ${String(s.seul).padStart(5)}   rien à quoi le comparer, et ça ne devrait pas`);
  console.log(`    dont tout va bien         ${String(s.accord).padStart(5)}   le scanner criait pour rien`);
  console.log(`  sans réponse possible       ${String(s.hors_champ).padStart(5)}`);
  console.log(`  + trouvés par l'apparieur   ${String(s.apparieur_seul).padStart(5)}   que le scanner ne voyait pas`);
  console.log(`  temps                       scanner ${s.ms_scanner} ms · apparieur ${s.ms_apparieur} ms\n`);

  for (const c of R.constats.slice(0, 15)) {
    console.log(`  [${c.reponse}] ${c.titre || c.texte}`);
    console.log(`      ${c.ou || `${c.fichier}:${c.ligne}`}${c.regle ? `   (désigné par ${c.regle})` : '   (apparieur seul)'}`);
    if (c.detail) console.log(`      ${c.detail}`);
  }
  if (R.constats.length > 15) console.log(`\n  … et ${R.constats.length - 15} autres constats.`);
}

main();

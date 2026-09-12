#!/usr/bin/env node
/**
 * fausses-donnees.mjs — la fausse donnée laissée en base.
 *
 *     node fausses-donnees.mjs <repo> [--json f]
 *
 * LE PROBLÈME
 *
 * Quand on construit un écran, on y met de la fausse donnée pour voir le rendu. Puis
 * l'écran est branché, mais la fausse donnée reste en base, à côté des vraies fiches
 * du client. Et là, ça ne se voit plus dans le code : le code est parfait, c'est le
 * contenu qui est pollué.
 *
 * C'est la cause racine n°1 mesurée sur projet client A le 11/09/2026, trouvée indépendamment par
 * quatre agents. Elle produit les pires symptômes : un courtier ouvre sa journée sur un
 * agenda de personnes qui n'existent pas, et surtout, quand le code cherche « Marc
 * Lefèvre » parmi 7 885 contacts réels et ne le trouve pas, il ouvre la première fiche
 * de la liste sans le dire — c'est-à-dire une VRAIE cliente avec ses coordonnées.
 *
 * DEUX FAÇONS DE LES RECONNAÎTRE, ET LA PREMIÈRE VAUT LES DEUX AUTRES
 *
 *   1. À LA SOURCE. Le fichier qui les a injectées dit exactement ce qu'il a mis. On
 *      lit `seed.ts` / `mock` / `fixtures` et on en extrait les valeurs littérales.
 *      Zéro devinette, zéro faux positif : ces valeurs SONT de la fausse donnée.
 *   2. AU MOTIF. Pour ce qui a été saisi à la main pendant une démo : noms de fiction,
 *      domaines d'exemple, téléphones en séquence, « test », « azerty », « lorem ».
 *      Moins sûr, donc toujours séparé du reste dans le rapport.
 *
 * CE QUE CET OUTIL NE FAIT PAS : supprimer. Il produit la liste des marqueurs et l'endroit
 * où ils apparaissent. La suppression touche la base d'un client : elle se décide à la
 * main, une fois qu'un humain a regardé la liste.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

// `.backend` est le dossier de travail de CE skill : s'y analyser soi-même produit
// des constats qui parlent de nos propres rapports. Vu en vrai.
const IGNORE = /node_modules|\.next|\.git|_generated|dist|build|\.backend/;
const SEMEUR = /(^|\/)(seed|seeds|mock|mocks|fixture|fixtures|demo|sample|faker|factice)[\w.-]*\.(ts|tsx|js|mjs|json)$/i;

function fichiers(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (IGNORE.test(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) fichiers(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

const tous = fichiers(RACINE);
const rel = (p) => path.relative(RACINE, p);

/* ── Qui est VRAI dans ce produit ───────────────────────────────────────────────
   Le semeur contient forcément le nom du client, de son agence et de ses vrais
   collaborateurs : il sème des données POUR eux. Les signaler comme fausses est le
   faux positif principal de cet outil — sur projet client A, « Jean Dupont » sortait en tête
   alors que c'est le client lui-même. On apprend qui est réel dans les fichiers de
   configuration client, et on le retire des marqueurs. */
const REELS = new Set();
for (const p of tous) {
  if (!/clients?\/[\w-]+\.config\.json$|\.env/.test(rel(p))) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/"([A-ZÀ-Ý][a-zà-ÿ]{2,15}(?: [A-ZÀ-Ý][a-zà-ÿ']{2,20}){1,2})"/g)) REELS.add(m[1]);
  for (const m of src.matchAll(/"([\w.+-]+@[\w.-]+\.\w{2,})"/g)) REELS.add(m[1]);
}

/* Les noms de produits et de services ne sont pas des personnes. */
const MARQUES = /\b(Google|Microsoft|Apple|Meta|Facebook|Instagram|WhatsApp|Stripe|Convex|Next|Vercel|Clerk|Dropbox|Outlook|Gmail|Zoom|Teams|Slack|Notion|Airtable|Pipedrive|HubSpot|Calendar|Drive|Maps|Cloud|Business|Analytics|Ads)\b/;

/* ── 1. À la source : ce que les semeurs ont injecté ────────────────────────── */

const semeurs = tous.filter((p) => SEMEUR.test(rel(p)));
const marqueurs = new Map();     // valeur → { type, fichier }

/* On ne prend que les littéraux qui IDENTIFIENT quelque chose : un nom propre, un
   email, un téléphone, une adresse. Les libellés d'interface (« Enregistrer »,
   « Aucun résultat ») sont dans les mêmes fichiers et ne sont pas des données. */
const IDENTIFIANT = [
  { type: 'email', re: /["'`]([\w.+-]+@[\w.-]+\.\w{2,})["'`]/g },
  { type: 'téléphone', re: /["'`](\+?[\d][\d\s().-]{7,17}\d)["'`]/g },
  { type: 'nom', re: /["'`]([A-ZÀ-Ý][a-zà-ÿ]{2,15}(?: [A-ZÀ-Ý][a-zà-ÿ']{2,20}){1,2})["'`]/g },
];

for (const p of semeurs) {
  const src = fs.readFileSync(p, 'utf8');
  for (const { type, re } of IDENTIFIANT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const v = m[1].trim();
      if (v.length < 4) continue;
      if (REELS.has(v)) continue;              // le vrai client, pas une fausse donnée
      if (type === 'nom' && MARQUES.test(v)) continue;   // « Google Calendar » n'est pas quelqu'un
      if (!marqueurs.has(v)) marqueurs.set(v, { type, fichier: rel(p) });
    }
  }
}

/* ── 2. Au motif : ce qui sent la démo, où qu'il soit ───────────────────────── */

const MOTIFS = [
  { quoi: 'nom de fiction', re: /\b(John Doe|Jane Doe|Jean Dupont|Marie Dupont|Foo Bar|Lorem Ipsum|Test Test)\b/gi },
  { quoi: 'domaine d\'exemple', re: /@(example|test|demo|acme|foo|bar|mail|domain)\.(com|org|net|fr|ch)\b/gi },
  { quoi: 'téléphone en séquence', re: /\b0[1-9](?:[ .-]?(?:12|23|34|45|56|67|78|89)){3,4}\b/g },
  { quoi: 'texte de remplissage', re: /\blorem ipsum\b|\basdf\b|\bazerty\b|\bqwerty\b|\bblabla\b|\btoto\b/gi },
  { quoi: 'marqueur de test', re: /\b(ZZ[-_]?TEST|BANC[ _-]?TEST|TEST[ _-]?QA|A ?SUPPRIMER|TODO ?REMOVE|FIXME ?DATA)\b/gi },
];

const parMotif = new Map();
for (const p of tous) {
  const r = rel(p);
  if (SEMEUR.test(r)) continue;                    // déjà couvert par l'étage 1
  const src = fs.readFileSync(p, 'utf8');
  for (const { quoi, re } of MOTIFS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const ligne = src.slice(0, m.index).split('\n').length;
      if (!parMotif.has(quoi)) parMotif.set(quoi, []);
      parMotif.get(quoi).push({ valeur: m[0].slice(0, 50), ou: `${r}:${ligne}` });
    }
  }
}

/* ── 3. Où ces marqueurs apparaissent AILLEURS que chez le semeur ──────────────
   Un marqueur qui ne vit que dans le semeur est inerte. Le même marqueur dans un
   composant d'écran veut dire que la fausse donnée est affichée en dur. */
const affiches = [];
for (const p of tous) {
  const r = rel(p);
  if (SEMEUR.test(r)) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const [v, info] of marqueurs) {
    const i = src.indexOf(v);
    if (i < 0) continue;
    affiches.push({ valeur: v, type: info.type, semeur: info.fichier,
      ou: `${r}:${src.slice(0, i).split('\n').length}` });
  }
}

const R = {
  racine: RACINE,
  semeurs: semeurs.map(rel),
  marqueurs: [...marqueurs].map(([v, i]) => ({ valeur: v, ...i })),
  affiches,
  motifs: [...parMotif].map(([quoi, l]) => ({ quoi, n: l.length, exemples: l.slice(0, 5) })),
};

console.log(`\n  FAUSSES DONNÉES — ${path.basename(RACINE)}`);
console.log(`  ${'-'.repeat(72)}`);

if (!semeurs.length) console.log('\n  Aucun fichier de fausses données trouvé dans le dépôt.');
else {
  console.log(`\n  ${semeurs.length} fichier(s) injectent de la fausse donnée :`);
  for (const p of semeurs) console.log(`    ${rel(p)}  (${fs.readFileSync(p, 'utf8').split('\n').length} lignes)`);
  console.log(`\n  ${marqueurs.size} valeurs identifiantes à chercher EN BASE`);
  console.log(`  (noms, emails, téléphones : ce sont elles qui polluent les vraies fiches)\n`);
  const parType = {};
  for (const [v, i] of marqueurs) (parType[i.type] ||= []).push(v);
  for (const [t, l] of Object.entries(parType)) {
    console.log(`    ${t} (${l.length}) : ${l.slice(0, 6).join(', ')}${l.length > 6 ? '…' : ''}`);
  }
}

if (affiches.length) {
  console.log(`\n\n  ⛔ AFFICHÉES EN DUR DANS DES ÉCRANS (${affiches.length})`);
  console.log(`  Ces fausses valeurs ne sont pas seulement en base : elles sont écrites`);
  console.log(`  dans le code d'un écran, donc elles s'affichent quoi qu'il arrive.\n`);
  for (const a of affiches.slice(0, 12)) console.log(`    « ${a.valeur} »  ${a.ou}`);
  if (affiches.length > 12) console.log(`    … et ${affiches.length - 12} autres`);
}

if (R.motifs.length) {
  console.log(`\n\n  AU MOTIF, moins sûr, à vérifier à l'œil`);
  for (const m of R.motifs) {
    console.log(`\n    ${m.quoi} (${m.n})`);
    for (const e of m.exemples) console.log(`      « ${e.valeur} »  ${e.ou}`);
  }
}

console.log(`\n\n  CE QU'IL FAUT FAIRE ENSUITE`);
console.log(`  Chercher ces valeurs dans la base du produit, pas seulement dans le code.`);
console.log(`  Un marqueur qui n'existe qu'ici est inerte ; le même trouvé en base à côté`);
console.log(`  des vraies fiches est la cause racine. La suppression se décide à la main.\n`);

const j = arg('--json', null);
if (j) fs.writeFileSync(path.resolve(j), JSON.stringify(R, null, 1));
process.exitCode = affiches.length ? 1 : 0;

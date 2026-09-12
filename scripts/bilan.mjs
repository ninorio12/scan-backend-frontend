#!/usr/bin/env node
/**
 * bilan.mjs : le dernier écran, celui qu'on lit à la fin.
 *
 *     node bilan.mjs <repo> [--md fichier.md]
 *
 * Il ne relance rien : il rassemble ce que les outils ont écrit dans `<repo>/.backend/`
 * et rend UN verdict, sur UNE échelle. C'est la seule échelle de gravité du skill ;
 * tout autre rendu (score sur 100, boss, décompte par règle) a été retiré parce que
 * quatre échelles qui se contredisent ne renseignent personne.
 *
 * L'ÉCHELLE, par gravité pour le client, jamais par quantité
 *
 *   TROMPE       le client voit quelque chose de faux : une donnée qui n'en est pas une,
 *                un chiffre faux, une action qui annonce un succès qui n'a pas eu lieu.
 *                Côté écran comme côté code : « Enregistré » sans écriture est une
 *                tromperie, qu'on l'ait vue en cliquant ou en lisant la mutation.
 *   CASSÉ        ça ne marche pas, et ça se voit : bouton mort, lien mort, page vide,
 *                écran illisible, porte publique sans garde.
 *   DETTE        rien de visible aujourd'hui, du temps perdu demain : plusieurs sources,
 *                code mort, calcul fragile côté serveur.
 *   NON REGARDÉ  ce que les outils n'ont pas pu vérifier, et pourquoi. Tant que cette
 *                liste n'est pas vide, le niveau est INCONNU : aucun autre ne serait honnête.
 *
 * Deux cents dettes valent moins qu'UNE tromperie : la première coûte du temps, la
 * seconde coûte la confiance (leçon d'un audit client : 599 défauts comptés, et le plus
 * coûteux était qu'un nom cliqué ouvrait la fiche de quelqu'un d'autre).
 *
 * CE QUI COMPTE COMME « NON REGARDÉ » : uniquement ce qui n'a réellement pas tourné.
 * Il lit `reconnaissance.json` (écrit par reconnaitre.mjs, ou par couverture.mjs qui
 * l'appelle) pour savoir si l'application était accessible et si la base est exportable,
 * et `fausses-en-base.json` pour savoir si nettoyer-base a tourné, a sauté ou a échoué.
 *
 * CODES DE SORTIE : 0 sain · 1 des problèmes · 2 incomplet (INCONNU).
 */

import fs from 'node:fs';
import path from 'node:path';
import { dossierBackend } from './dossier-backend.mjs';

const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
if (!fs.existsSync(RACINE)) { console.error(`Dépôt introuvable : ${RACINE} (usage : bilan.mjs <repo>)`); process.exit(2); }
const D = dossierBackend(RACINE);
const lire = (f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch { return null; } };

const carte = lire('reconnaissance.json');
const scan = lire('scan.json') || lire('dialogue.json');
const lexical = lire('lexical.json');
const fausses = lire('fausses.json');
const enBase = lire('fausses-en-base.json');
const liens = lire('liens.json');
const couv = lire('couverture.json');
const questions = lire('questions.json');
const decisions = lire('decisions.json');
const clics = fs.readdirSync(D).filter((f) => /^clics_/.test(f)).map(lire).filter(Boolean);
const apparences = fs.readdirSync(D).filter((f) => /^apparence_/.test(f)).map(lire).filter(Boolean);

/* ── L'échelle ──────────────────────────────────────────────────────────────── */

const TROMPE = 1, CASSE = 2, DETTE = 3;
const NIVEAU = { 1: 'trompe', 2: 'cassé', 3: 'dette' };
const trouve = [];
const ajouter = (gravite, famille, quoi, ou, detail) => trouve.push({ gravite, famille, quoi, ou, detail });

/* Côté écran : ce que le client subit directement. */
for (const c of clics) {
  for (const v of c.verdicts || []) {
    if (v.verdict === 'MENT') ajouter(TROMPE, 'annonce un succès sans écrire', `« ${v.libelle} »`, c.url, v.pourquoi);
    else if (v.verdict === 'ERREUR') ajouter(TROMPE, 'erreur au clic', `« ${v.libelle} »`, c.url, v.pourquoi);
    else if (v.verdict === 'CASSÉ') ajouter(TROMPE, 'écran qui se casse', `« ${v.libelle} »`, c.url, v.pourquoi);
    else if (v.verdict === 'MORT') ajouter(CASSE, 'bouton mort', `« ${v.libelle} »`, c.url, v.pourquoi);
    else if (v.verdict === 'SILENCIEUX') ajouter(DETTE, 'plantage invisible', `« ${v.libelle} »`, c.url, v.pourquoi);
  }
}
for (const v of liens?.verdicts || []) {
  ajouter(CASSE, v.verdict === 'MORT' ? 'lien mort' : 'page vide',
    `« ${v.href} »`, (v.depuis || []).length ? `depuis ${(v.depuis || []).slice(0, 3).join(', ')}` : '', v.pourquoi);
}
for (const ap of apparences) {
  for (const c of ap.constats || []) {
    const grave = /CASSÉ|INVISIBLE|HORS[- ]ÉCRAN/i.test(c.type);
    ajouter(grave ? CASSE : DETTE, `apparence : ${c.type.toLowerCase()}`, c.quoi, ap.url, `${c.detail} (${c.ou_quand})`);
  }
}

/* Côté code : le même barème. Ce qui trompe le client se lit aussi dans une mutation. */
const racinePages = carte?.racinePages || 'app';
const estEcran = (ou = '') => new RegExp(`^(${racinePages}|src/app|app|pages|src/pages|components|src/components)/`).test(ou) || /\.(tsx|jsx|svelte|vue)(:|$)/.test(ou);
const MENT = /annonce (un )?succès|annonce « |confirme sans|répond (quand même|succès)|avale sa panne|sans (rien )?écrire|n'écrit (rien|jamais)|ne (le )?lit jamais|l'écran croit|jamais (écrit|patché)/i;
const EN_DUR = /en dur|forme de la vraie donnée|chiffres? inventés?|de démonstration|placeholder/i;
const CHIFFRE_FAUX = /comme s'il l'avait (mesuré|calculé)|affiche \S+ comme si/i;

for (const c of scan?.constats || []) {
  if (c.reponse !== 'DÉSACCORD' && c.reponse !== 'SEUL') continue;
  const texte = `${c.titre || ''} ${c.texte || ''} ${c.detail || ''}`;
  const attribut = c.attribut || 'source';
  const ou = c.ou || `${c.fichier}:${c.ligne}`;
  let gravite, famille;
  if (MENT.test(texte) || /^D2$/.test(c.regle || '')) { gravite = TROMPE; famille = 'annonce un succès sans écrire'; }
  else if (EN_DUR.test(texte) || /^(D1|D4|D5|D7)$/.test(c.regle || '')) { gravite = TROMPE; famille = 'valeur en dur affichée'; }
  else if (CHIFFRE_FAUX.test(texte)) { gravite = TROMPE; famille = 'chiffre faux à l\'écran : repli inventé'; }
  else if (attribut === 'existence' && estEcran(ou)) { gravite = TROMPE; famille = 'écran relié à rien'; }
  else if (['formule', 'population', 'unite', 'unité'].includes(attribut) && estEcran(ou)) { gravite = TROMPE; famille = `chiffre faux à l'écran : ${attribut}`; }
  else if (attribut === 'garde') { gravite = CASSE; famille = 'porte sans garde'; }
  else { gravite = DETTE; famille = `désaccord côté serveur : ${attribut}`; }
  ajouter(gravite, famille, c.titre || c.texte, ou, c.detail || '');
}
for (const c of lexical?.sourcesMultiples || []) {
  ajouter(DETTE, 'plusieurs sources', `« ${c.concept} » lu depuis ${c.sources.length} endroits`,
    c.sources.map((s) => s.table).slice(0, 4).join(', '), 'une donnée doit avoir une source unique');
}
for (const d of lexical?.sansProprietaire || []) {
  ajouter(DETTE, 'plusieurs auteurs', `« ${d.table} » écrite par ${d.locataires.length + 1} modules`,
    d.locataires.slice(0, 3).map((l) => path.basename(l)).join(', '), 'une table doit avoir un propriétaire');
}
for (const a of fausses?.affiches || []) ajouter(TROMPE, 'fausse donnée affichée', `« ${a.valeur} »`, a.ou, 'écrite en dur dans un écran');
if (enBase?.suspects) {
  for (const t of enBase.parTable || []) {
    ajouter(TROMPE, 'fausse donnée en base', `${t.suspects.length} documents dans « ${t.table} »`,
      `${t.lignes} documents au total`, 'cohabitent avec les vraies fiches du client');
  }
}
trouve.sort((a, b) => a.gravite - b.gravite);

/* ── RÉSOLU ─────────────────────────────────────────────────────────────────── */

const resolu = [];
try { for (const r of JSON.parse(fs.readFileSync(path.join(D, 'reparations.json'), 'utf8')).reparations || []) resolu.push(r); } catch { /* aucune */ }
for (const f of fs.readdirSync(D).filter((x) => /\.patch$/.test(x))) {
  const n = fs.readFileSync(path.join(D, f), 'utf8').split('\n').filter((l) => /^\+\+\+/.test(l)).length;
  resolu.push({ quoi: `correctif prêt : ${f}`, detail: `${n} fichier(s) modifié(s), à appliquer ou non` });
}

/* ── NON REGARDÉ : uniquement ce qui n'a réellement pas tourné ──────────────── */

const nonFait = [];
const notes = [];
if (!carte) nonFait.push('la reconnaissance du projet n\'a pas tourné (scripts/reconnaitre.mjs)');
if (!scan) nonFait.push('le scan du code n\'a pas tourné (scripts/scan.mjs)');

const app = carte?.application;
if (carte && app && app.statut !== 'confirmée') {
  const pourquoi = app.statut === 'éteinte' ? 'l\'application ne répondait pas'
    : app.statut === 'authentification' ? `${app.url} ${app.detail}`
      : app.statut === 'non-html' ? `${app.url} : ${app.detail}`
        : `une application répond sur ${app.url} mais rien ne prouve que c'est ce projet (${app.detail})`;
  nonFait.push(`côté écran non regardé : ${pourquoi}`);
} else {
  if (!liens) nonFait.push('les liens n\'ont pas été suivis (node scripts/liens.mjs)');
  if (!clics.length) nonFait.push('aucun écran n\'a été cliqué (scripts/couverture.mjs --url …)');
}
for (const r of couv?.raccourcis || []) if (!nonFait.some((n) => n.includes(r))) nonFait.push(r);
for (const [nom, e] of Object.entries(couv?.etapes || {})) {
  if (e && typeof e === 'object' && /échec|erreur/i.test(e.statut || '')) nonFait.push(`${nom} : ${e.statut}${e.raison ? ` (${e.raison})` : ''}`);
  else if (typeof e === 'string' && /échec|erreur/i.test(e)) nonFait.push(`${nom} : ${e}`);
}

if (!enBase) {
  if (carte && carte.base && carte.base !== 'Convex') nonFait.push(`la base (${carte.base}) n'a pas été inspectée : pas d'export automatique pour cette base, fournir un export à nettoyer-base.mjs --export`);
  else nonFait.push('la base n\'a pas été inspectée (scripts/nettoyer-base.mjs) : les fausses données n\'ont été cherchées que dans le code');
} else if (enBase.statut === 'sautée') {
  notes.push(`base non exportée : ${enBase.raison}`);
} else if (enBase.statut && enBase.statut !== 'inspectée') {
  nonFait.push(`la base n'a pas été inspectée : ${enBase.raison}`);
}
const aDecider = questions?.length ? questions.length : 0;

/* ── LE BAROMÈTRE ───────────────────────────────────────────────────────────── */

const quiTrompe = trouve.filter((t) => t.gravite === TROMPE);
const quiCasse = trouve.filter((t) => t.gravite === CASSE);
const dette = trouve.filter((t) => t.gravite === DETTE);
const familles = (l) => [...new Set(l.map((t) => t.famille))].join(', ');

let niveau, verdict, pourDescendre;
if (nonFait.length) {
  niveau = '⬛ INCONNU';
  verdict = 'Le produit n\'a pas été entièrement regardé : aucun niveau ne serait honnête.';
  pourDescendre = `Couvrir les ${nonFait.length} point(s) de la section « non regardé ».`;
} else if (quiTrompe.length) {
  niveau = '🟥 À NE PAS LIVRER';
  verdict = `${quiTrompe.length} chose(s) trompent l'utilisateur : il voit une donnée qui n'en est pas une, `
    + 'un chiffre faux, ou une action lui annonce un succès qui n\'a pas eu lieu. C\'est ce qui coûte la confiance.';
  pourDescendre = `Corriger les ${quiTrompe.length} tromperies : ${familles(quiTrompe)}.`;
} else if (quiCasse.length) {
  niveau = '🟧 LIVRABLE AVEC RÉSERVES';
  verdict = `Rien ne trompe l'utilisateur, mais ${quiCasse.length} chose(s) ne marchent pas : `
    + 'des boutons sans effet, des liens qui ne mènent nulle part, des écrans illisibles, des portes ouvertes.';
  pourDescendre = `Réparer les ${quiCasse.length} éléments cassés : ${familles(quiCasse)}.`;
} else if (dette.length) {
  niveau = '🟨 SAIN, AVEC DE LA DETTE';
  verdict = `Rien de cassé pour l'utilisateur. Restent ${dette.length} point(s) qui coûteront du temps plus tard.`;
  pourDescendre = 'Trancher les sources de vérité (voir les questions) et solder la dette.';
} else {
  niveau = '🟩 SAIN';
  verdict = 'Tous les modules et tous les boutons ont été vérifiés, rien à signaler.';
  pourDescendre = '';
}

/* ── Le document ────────────────────────────────────────────────────────────── */

const nom = carte?.nom || path.basename(RACINE);
const par = {};
for (const t of trouve) (par[t.famille] ||= []).push(t);

let md = `# Bilan : ${nom}\n\n${new Date().toLocaleString('fr-CH')}\n\n`;
md += `## ${niveau}\n\n${verdict}\n\n`;
if (pourDescendre) md += `Pour passer au niveau en dessous : ${pourDescendre}\n\n`;
md += `| | |\n|---|---|\n`;
md += `| trompe l'utilisateur | ${quiTrompe.length} |\n| cassé | ${quiCasse.length} |\n| dette | ${dette.length} |\n| non regardé | ${nonFait.length} |\n`;
if (aDecider) md += `| à décider par un humain | ${aDecider} |\n`;
md += `\n${trouve.length} problèmes trouvés · ${resolu.length} résolus · ${nonFait.length} points non regardés\n\n`;
if (carte) md += `${carte.cadre} · ${carte.base} · ${carte.deploiement || ''} · ${carte.modules?.length || 0} modules · ${carte.tables?.length || 0} tables\n\n`;

md += `## Trouvé\n\n`;
for (const [famille, l] of Object.entries(par).sort((a, b) => a[1][0].gravite - b[1][0].gravite || b[1].length - a[1].length)) {
  md += `### ${famille} : ${l.length} (${NIVEAU[l[0].gravite]})\n\n`;
  for (const t of l.slice(0, 15)) md += `- ${t.quoi}${t.ou ? ` · \`${t.ou}\`` : ''}${t.detail ? `\n  ${t.detail}` : ''}\n`;
  if (l.length > 15) md += `- … et ${l.length - 15} autres (le détail complet est dans les JSON de .backend/)\n`;
  md += `\n`;
}
if (!trouve.length) md += `Rien. Vérifier d'abord que les outils ont tourné (voir « non regardé »).\n\n`;

md += `## Résolu\n\n`;
if (resolu.length) for (const r of resolu) md += `- ${r.quoi}${r.detail ? ` : ${r.detail}` : ''}\n`;
else md += `Rien encore. Les correctifs se préparent sur copie et s'appliquent à la main.\n`;
md += `\n## Non regardé\n\n`;
if (nonFait.length) { md += `Ce rapport ne prouve rien sur les points suivants :\n\n`; for (const n of nonFait) md += `- ${n}\n`; }
else md += `Rien : tous les modules, tous les boutons, tout le code.\n`;
for (const n of notes) md += `\nNote : ${n}\n`;
md += `\n`;
if (aDecider) md += `## À décider par un humain\n\n${aDecider} question(s) de source de vérité dans \`.backend/questions.json\` (scripts/decisions.mjs).\n\n`;
if (decisions && Object.keys(decisions).length) {
  md += `## Décisions prises\n\n`;
  for (const [k, v] of Object.entries(decisions)) md += `- « ${k} » fait foi depuis \`${v.source}\` (${v.decide}, ${v.par})\n`;
  md += `\n`;
}

const sortie = arg('--md', path.join(D, 'BILAN.md'));
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, md);

console.log(`\n  BILAN · ${nom}`);
console.log(`  ${'='.repeat(72)}`);
console.log(`\n  ${niveau}\n`);
console.log(`  ${verdict.replace(/(.{68}\s)/g, '$1\n  ')}`);
if (pourDescendre) console.log(`\n  → ${pourDescendre.replace(/(.{66}\s)/g, '$1\n    ')}`);
console.log(`\n  ${'-'.repeat(72)}`);
console.log(`  trompe l'utilisateur ${String(quiTrompe.length).padStart(5)}`);
console.log(`  cassé                ${String(quiCasse.length).padStart(5)}`);
console.log(`  dette                ${String(dette.length).padStart(5)}`);
console.log(`  non regardé          ${String(nonFait.length).padStart(5)}`);
if (aDecider) console.log(`  à décider            ${String(aDecider).padStart(5)}`);
console.log(`  ${trouve.length} problèmes trouvés · ${resolu.length} résolus`);
for (const n of nonFait) console.log(`      ⚠️  ${n.replace(/(.{76}\s)/g, '$1\n          ')}`);
for (const n of notes) console.log(`      · ${n}`);
console.log(`\n  ${sortie}\n`);
process.exitCode = nonFait.length ? 2 : (trouve.length ? 1 : 0);

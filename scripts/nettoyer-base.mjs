#!/usr/bin/env node
/**
 * nettoyer-base.mjs : les fausses données DANS LA BASE, pas dans le code.
 *
 *     node nettoyer-base.mjs <repo> [--json f] [--export <fichier.zip|dossier>] [--liste]
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `fausses-donnees.mjs` lit le code et sort la liste de ce que les fichiers d'injection
 * ont semé (sur un projet client : 81 noms, emails et téléphones). Et il s'arrêtait là.
 * Or c'est en base que ces valeurs font des dégâts : le code est parfait, c'est le
 * contenu qui est pollué. Sortir une liste sans aller la chercher, c'est un demi travail,
 * et un demi travail se fait passer pour un travail.
 *
 * Ici on exporte la base réelle et on compte. Table par table, ligne par ligne, avec
 * l'identifiant exact de chaque document à retirer.
 *
 * CE QU'IL NE FAIT JAMAIS : supprimer. Il produit la liste des identifiants. La
 * suppression dans la base d'un client se décide devant la liste, avec un humain.
 *
 * OÙ VA L'EXPORT : dans le dossier temporaire du système, jamais dans le dépôt, et il
 * est supprimé après lecture. `npx convex export` produit une archive ZIP (un fichier
 * `<table>/documents.jsonl` par table) ; elle est décompressée avec `unzip`, sinon avec
 * `python3 -m zipfile`. Sans l'un des deux : code 2, et on le dit.
 *
 * CE QU'IL ÉCRIT DANS LE DÉPÔT : `.backend/fausses-en-base.json`, toujours, même quand il
 * n'a pas pu inspecter (avec `statut` et `raison`), pour que le bilan sache ce qui a
 * réellement tourné.
 *
 * COMMENT IL DISTINGUE LE VRAI DU FAUX
 *   1. La valeur vient du semeur : preuve la plus forte, elle n'a pas d'autre origine.
 *   2. Le document porte un marqueur de test évident (ZZ-TEST, BANC TEST…).
 *
 * CODES DE SORTIE : 0 rien de suspect · 1 des documents suspects · 2 base non inspectée.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ecrireJson } from './dossier-backend.mjs';

const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const a = (n) => process.argv.includes(n);
const ICI = path.dirname(new URL(import.meta.url).pathname);

if (!fs.existsSync(RACINE)) { console.error(`Dépôt introuvable : ${RACINE}`); process.exit(2); }

/* Le résultat est écrit quoi qu'il arrive : le bilan ne doit jamais deviner. */
function conclure(statut, raison, extra = {}, code = 2) {
  const R = { racine: RACINE, statut, raison, inspectee: statut === 'inspectée', ...extra };
  const j = ecrireJson(RACINE, 'fausses-en-base.json', R, arg('--json', null));
  if (code === 2) console.error(`\n  ⛔ Base non inspectée : ${raison}`);
  console.log(`  Détail : ${j}\n`);
  process.exit(code);
}

/* ── 1. Les marqueurs, repris du code ──────────────────────────────────────── */

const tmpJson = path.join(os.tmpdir(), `marqueurs-${process.pid}.json`);
try {
  execFileSync('node', [path.join(ICI, 'fausses-donnees.mjs'), RACINE, '--json', tmpJson],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, stdio: 'ignore' });
} catch { /* code 1 = des marqueurs trouvés, c'est normal */ }

let M;
try { M = JSON.parse(fs.readFileSync(tmpJson, 'utf8')); }
catch { conclure('échec', 'impossible de lire les marqueurs du code (fausses-donnees.mjs n\'a rien produit)'); }
try { fs.unlinkSync(tmpJson); } catch { /* déjà parti */ }

const valeurs = new Map((M.marqueurs || []).map((m) => [m.valeur, m.type]));
if (!valeurs.size) {
  console.log('\n  Aucun marqueur de fausse donnée dans le code : rien à chercher en base.\n');
  conclure('sautée', 'aucun marqueur de fausse donnée dans le code, la base n\'a pas été exportée',
    { suspects: 0, marqueurs: 0 }, 0);
}

/* ── 2. La base, exportée hors du dépôt ────────────────────────────────────── */

let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')); } catch { /* pas de package.json */ }
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const exportFourni = arg('--export', null) || arg('--reutiliser-export', null);

if (!exportFourni && !deps.convex && !fs.existsSync(path.join(RACINE, 'convex'))) {
  conclure('impossible', 'la base n\'est pas Convex : pas d\'export automatique, fournir un export avec --export <zip|dossier>');
}

const env = ['.env.local', '.env'].map((f) => { try { return fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { return ''; } }).join('\n');
const deploiement = (env.match(/^CONVEX_DEPLOYMENT=([^\n]+)/m) || [])[1] || '';
if (/^prod:/.test(deploiement)) console.log('\n  ⚠️  Déploiement de PRODUCTION : export en lecture seule, rien n\'est écrit en base.');

const aJeter = [];
const nettoyer = () => { for (const p of aJeter) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* tant pis */ } } };
process.on('exit', nettoyer);

let dossier;   // le dossier qui contient les .jsonl
if (exportFourni && fs.existsSync(exportFourni) && fs.statSync(exportFourni).isDirectory()) {
  dossier = path.resolve(exportFourni);
} else {
  let zip = exportFourni ? path.resolve(exportFourni) : path.join(os.tmpdir(), `scan-backend-export-${process.pid}.zip`);
  if (!exportFourni) {
    aJeter.push(zip);
    console.log(`\n  Export de la base (${deploiement || 'déploiement du projet'}) vers le dossier temporaire …`);
    try {
      execFileSync('npx', ['convex', 'export', '--path', zip], {
        cwd: RACINE, encoding: 'utf8', timeout: 900000, stdio: 'pipe',
      });
    } catch (e) {
      conclure('échec', `l'export Convex a échoué : ${String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ').slice(0, 240)}`);
    }
  }
  if (!fs.existsSync(zip)) conclure('échec', `aucune archive produite (${zip})`);

  dossier = path.join(os.tmpdir(), `scan-backend-export-${process.pid}`);
  aJeter.push(dossier);
  fs.mkdirSync(dossier, { recursive: true });
  const outil = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
  try {
    if (outil('unzip')) execFileSync('unzip', ['-o', '-q', zip, '-d', dossier], { stdio: 'pipe' });
    else if (outil('python3')) execFileSync('python3', ['-m', 'zipfile', '-e', zip, dossier], { stdio: 'pipe' });
    else conclure('impossible', 'ni unzip ni python3 sur cette machine : impossible d\'ouvrir l\'archive de l\'export (en installer un)');
  } catch (e) {
    if (e && e.stderr !== undefined) conclure('échec', `l'archive n'a pas pu être décompressée : ${String(e.stderr || e.message).slice(0, 200)}`);
    throw e;
  }
}

/* Convex exporte `<table>/documents.jsonl` ; on accepte aussi `<table>.jsonl`. */
function tables(d) {
  const out = [];
  const marcher = (x) => {
    for (const e of fs.readdirSync(x, { withFileTypes: true })) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) marcher(p);
      else if (/\.jsonl$/.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(d)) marcher(d);
  return out;
}
const nomTable = (f) => (/^documents\.jsonl$/.test(path.basename(f))
  ? path.basename(path.dirname(f)) : path.basename(f, '.jsonl'));

const fichiersTables = tables(dossier);
if (!fichiersTables.length) conclure('échec', `aucune table (.jsonl) dans l'export (${dossier})`);

/* ── 3. Le comptage ────────────────────────────────────────────────────────── */

const MARQUEUR_TEST = /\b(ZZ[-_ ]?TEST|BANC[ _-]?TEST|TEST[ _-]?QA|A ?SUPPRIMER|DEMO[ _-]?ONLY)\b/i;

const parTable = [];
let totalLignes = 0, totalSuspects = 0;

for (const f of fichiersTables) {
  const table = nomTable(f);
  if (/^_/.test(table)) continue;   // tables système de l'export
  const lignes = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  totalLignes += lignes.length;
  const suspects = [];
  for (const l of lignes) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    const texte = JSON.stringify(d);
    const touches = [];
    for (const [v] of valeurs) if (texte.includes(v)) touches.push(v);
    if (touches.length) suspects.push({ id: d._id, pourquoi: 'valeur semée par le fichier d\'injection', valeurs: touches.slice(0, 3) });
    else if (MARQUEUR_TEST.test(texte)) suspects.push({ id: d._id, pourquoi: 'porte un marqueur de test', valeurs: [] });
  }
  if (suspects.length) { totalSuspects += suspects.length; parTable.push({ table, lignes: lignes.length, suspects }); }
}
parTable.sort((x, y) => y.suspects.length - x.suspects.length);

/* ── 4. Le rapport ─────────────────────────────────────────────────────────── */

console.log(`\n  FAUSSES DONNÉES EN BASE · ${path.basename(RACINE)}`);
console.log(`  ${'-'.repeat(72)}`);
console.log(`  ${fichiersTables.length} tables · ${totalLignes} documents · ${valeurs.size} marqueurs cherchés`);
console.log(`  ${totalSuspects} documents suspects dans ${parTable.length} tables\n`);

for (const t of parTable) {
  const part = Math.round(t.suspects.length / t.lignes * 100);
  console.log(`  ${t.table.padEnd(22)} ${String(t.suspects.length).padStart(5)} / ${String(t.lignes).padEnd(6)} (${part} %)`);
  if (a('--liste')) {
    for (const s of t.suspects.slice(0, 8)) console.log(`      ${s.id}  ${s.valeurs.join(', ') || s.pourquoi}`);
    if (t.suspects.length > 8) console.log(`      … et ${t.suspects.length - 8} autres`);
  }
}

if (!parTable.length) console.log('  Aucune trace des marqueurs en base : le semeur n\'a pas tourné ici.');
else {
  console.log(`\n  CE QU'IL FAUT FAIRE, ET QUI NE SE FAIT PAS TOUT SEUL`);
  console.log(`  Ces ${totalSuspects} documents vivent à côté des vraies fiches du client. Tant qu'ils`);
  console.log(`  y sont, une recherche qui ne les trouve pas peut ouvrir la fiche de quelqu'un`);
  console.log(`  d'autre (vécu sur un projet client). La liste complète est dans le JSON ; la`);
  console.log(`  suppression se décide devant elle, avec quelqu'un qui connaît le métier.`);
  if (!a('--liste')) console.log(`\n  Relancer avec --liste pour voir les identifiants.`);
}

const j = ecrireJson(RACINE, 'fausses-en-base.json', {
  racine: RACINE, statut: 'inspectée', inspectee: true, deploiement: deploiement || null,
  tables: fichiersTables.length, documents: totalLignes, marqueurs: valeurs.size,
  suspects: totalSuspects, parTable,
}, arg('--json', null));
console.log(`\n  Détail : ${j}\n`);
process.exitCode = totalSuspects ? 1 : 0;

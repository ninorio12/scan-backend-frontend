#!/usr/bin/env node
/**
 * entree.mjs — L'ENTRÉE DE LA BOUCLE : le bilan, pas une liste écrite à la main.
 *
 * POURQUOI CE FICHIER EXISTE
 * La boucle de réparation partait jusqu'ici de `audit-backend.mjs` (règles A1…I5),
 * c'est-à-dire d'un AUTRE instrument que celui qui produit le verdict que lit
 * l'humain. Deux entrées, deux vocabulaires, et un chantier qui ne correspond pas au
 * rapport. La boucle part donc du BILAN : `.backend/BILAN.md` pour ce qui se lit, et
 * les JSON de `.backend/` (dialogue.json, lexical.json, liens.json, clics_*.json,
 * apparence_*.json, fausses*.json) pour ce qui se traite.
 *
 * L'ÉCHELLE EST CELLE DU BILAN, PAS UNE AUTRE
 * `scripts/bilan.mjs` classe sur trois niveaux : TROMPE (le client voit du faux),
 * CASSÉ (ça ne marche pas et ça se voit), DETTE (rien de visible aujourd'hui). Ce
 * fichier REJOUE cette classification à l'identique — mêmes motifs, mêmes seuils —
 * puis se contrôle contre le tableau de BILAN.md : si les comptes divergent, il le
 * DIT au lieu de continuer sur une autre échelle que celle qu'a lue l'humain.
 *
 * ⚠️ On ne peut pas importer bilan.mjs : c'est un script, pas un module (il exécute
 * au chargement et sort en code 2). D'où la reprise, et d'où le contrôle croisé.
 *
 * L'ORDRE DE TRAITEMENT SUIT LE BAROMÈTRE, JAMAIS LE NOMBRE
 * Deux cents dettes valent moins qu'UNE tromperie. Trier par nombre de défauts par
 * fichier ferait traiter en premier le fichier le plus bruyant, qui est presque
 * toujours le moins coûteux pour le client.
 *
 *   node entree.mjs <repo>            → la file, dans l'ordre où la traiter
 *   node entree.mjs <repo> --json     → sortie machine
 */

import fs from 'node:fs';
import path from 'node:path';
import { empreinteDe } from './empreintes.mjs';

/* ── Lecture de ce que les outils ont écrit ───────────────────────────────── */

export function dossier(racine) { return path.join(racine, '.backend'); }

function lire(racine, f) {
  try { return JSON.parse(fs.readFileSync(path.join(dossier(racine), f), 'utf8')); } catch { return null; }
}
function lireTous(racine, motif) {
  try {
    return fs.readdirSync(dossier(racine)).filter((f) => motif.test(f)).map((f) => lire(racine, f)).filter(Boolean);
  } catch { return []; }
}

/* ── L'échelle du bilan, reprise mot pour mot ─────────────────────────────── */

export const TROMPE = 1, CASSE = 2, DETTE = 3;
export const NIVEAU = { 1: 'trompe', 2: 'cassé', 3: 'dette' };

/* Motifs copiés de scripts/bilan.mjs. S'ils bougent là-bas, le contrôle croisé
   ci-dessous le révèle : les comptes ne tomberont plus sur ceux de BILAN.md. */
const MENT = /annonce (un )?succès|annonce « |confirme sans|répond (quand même|succès)|avale sa panne|sans (rien )?écrire|n'écrit (rien|jamais)|ne (le )?lit jamais|l'écran croit|jamais (écrit|patché)/i;
const EN_DUR = /en dur|forme de la vraie donnée|chiffres? inventés?|de démonstration|placeholder/i;
const CHIFFRE_FAUX = /comme s'il l'avait (mesuré|calculé)|affiche \S+ comme si/i;

/* ── Le code de règle porté par l'empreinte ───────────────────────────────────
   L'empreinte s'écrit `RÈGLE:hash(fichier#ancre)`. La « règle » d'un défaut du
   bilan est sa FAMILLE, ramenée à un code court et stable : deux exécutions du
   scanner sur le même code doivent produire le même identifiant, et un défaut ne
   doit pas changer d'identité parce que le libellé de sa famille a gagné un mot. */

const CODES = [
  [/annonce un succès sans écrire/i, 'ANNONCE'],
  [/valeur en dur affichée|fausse donnée affichée/i, 'ENDUR'],
  [/fausse donnée en base/i, 'ENBASE'],
  [/chiffre faux à l'écran/i, 'CHIFFRE'],
  [/écran relié à rien/i, 'ECRANVIDE'],
  [/porte sans garde/i, 'GARDE'],
  [/bouton mort/i, 'BOUTONMORT'],
  [/lien mort|page vide/i, 'LIENMORT'],
  [/erreur au clic|écran qui se casse/i, 'CLICCASSE'],
  [/plantage invisible/i, 'PLANTAGE'],
  [/apparence/i, 'APPARENCE'],
  [/plusieurs sources/i, 'SOURCES'],
  [/plusieurs auteurs/i, 'AUTEURS'],
  [/désaccord côté serveur/i, 'SERVEUR'],
];

export function codeDe(famille, attribut) {
  for (const [re, code] of CODES) {
    if (re.test(famille)) return code === 'SERVEUR' || code === 'CHIFFRE' ? `${code}-${(attribut || 'source').replace('é', 'e')}` : code;
  }
  return 'AUTRE';
}

/* ── La collecte ──────────────────────────────────────────────────────────── */

export function collecter(racine) {
  const carte = lire(racine, 'reconnaissance.json');
  const scan = lire(racine, 'scan.json') || lire(racine, 'dialogue.json');
  const lexical = lire(racine, 'lexical.json');
  const fausses = lire(racine, 'fausses.json');
  const enBase = lire(racine, 'fausses-en-base.json');
  const liens = lire(racine, 'liens.json');
  const clics = lireTous(racine, /^clics_/);
  const apparences = lireTous(racine, /^apparence_/);

  const trouve = [];
  const ajouter = (gravite, famille, quoi, ou, detail, extra = {}) =>
    trouve.push({ gravite, famille, quoi: String(quoi ?? ''), ou: String(ou ?? ''), detail: String(detail ?? ''), ...extra });

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
    ajouter(CASSE, v.verdict === 'MORT' ? 'lien mort' : 'page vide', `« ${v.href} »`,
      (v.depuis || []).length ? `depuis ${(v.depuis || []).slice(0, 3).join(', ')}` : '', v.pourquoi);
  }
  for (const ap of apparences) {
    for (const c of ap.constats || []) {
      const grave = /CASSÉ|INVISIBLE|HORS[- ]ÉCRAN/i.test(c.type);
      ajouter(grave ? CASSE : DETTE, `apparence : ${c.type.toLowerCase()}`, c.quoi, ap.url, `${c.detail} (${c.ou_quand})`);
    }
  }

  const racinePages = carte?.racinePages || 'app';
  const estEcran = (ou = '') =>
    new RegExp(`^(${racinePages}|src/app|app|pages|src/pages|components|src/components)/`).test(ou) || /\.(tsx|jsx|svelte|vue)(:|$)/.test(ou);

  for (const c of scan?.constats || []) {
    if (c.reponse !== 'DÉSACCORD' && c.reponse !== 'SEUL') continue;
    const texte = `${c.titre || ''} ${c.texte || ''} ${c.detail || ''}`;
    const attribut = c.attribut || 'source';
    const ou = c.ou || `${c.fichier}:${c.ligne}`;
    let gravite, famille;
    if (MENT.test(texte) || /^D2$/.test(c.regle || '')) { gravite = TROMPE; famille = 'annonce un succès sans écrire'; }
    else if (EN_DUR.test(texte) || /^(D1|D4|D5|D7)$/.test(c.regle || '')) { gravite = TROMPE; famille = 'valeur en dur affichée'; }
    else if (CHIFFRE_FAUX.test(texte)) { gravite = TROMPE; famille = "chiffre faux à l'écran : repli inventé"; }
    else if (attribut === 'existence' && estEcran(ou)) { gravite = TROMPE; famille = 'écran relié à rien'; }
    else if (['formule', 'population', 'unite', 'unité'].includes(attribut) && estEcran(ou)) { gravite = TROMPE; famille = `chiffre faux à l'écran : ${attribut}`; }
    else if (attribut === 'garde') { gravite = CASSE; famille = 'porte sans garde'; }
    else { gravite = DETTE; famille = `désaccord côté serveur : ${attribut}`; }
    ajouter(gravite, famille, c.titre || c.texte, ou, c.detail || '', {
      attribut, jumeaux: c.jumeaux || [], regleScan: c.regle || c.regleApp || null, confiance: c.confiance ?? null,
    });
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

  return trouve;
}

/* ── Le contrôle croisé contre BILAN.md ───────────────────────────────────────
   Le bilan est ce que l'humain a lu. Si la file ne compte pas comme lui, la boucle
   travaille sur une autre réalité : on l'écrit dans l'état plutôt que de laisser
   deux chiffres se contredire en silence. */

export function lireTableauBilan(racine) {
  let md;
  try { md = fs.readFileSync(path.join(dossier(racine), 'BILAN.md'), 'utf8'); } catch { return null; }
  const t = {};
  for (const [, nom, n] of md.matchAll(/^\|\s*(trompe l'utilisateur|cassé|dette|non regardé)\s*\|\s*(\d+)\s*\|/gm)) {
    t[nom === "trompe l'utilisateur" ? 'trompe' : nom] = Number(n);
  }
  const tot = md.match(/^(\d+) problèmes? trouvés?/m);
  return { ...t, total: tot ? Number(tot[1]) : null, existe: true };
}

/* ── La file : empreinte + baromètre ──────────────────────────────────────── */

/** L'item que `empreinteDe` sait parser : « fichier:ligne  titre ». */
function itemDe(d) { return `${d.ou} ${d.quoi}`.trim(); }

export function fileDeReparation(racine) {
  const bruts = collecter(racine);
  const vus = new Map();
  const collisions = [];

  for (const d of bruts) {
    const regle = codeDe(d.famille, d.attribut);
    const e = empreinteDe({ regle, item: itemDe(d), racine });
    const defaut = {
      ...e,
      gravite: d.gravite,
      niveau: NIVEAU[d.gravite],
      famille: d.famille,
      attribut: d.attribut || null,
      titre: d.quoi,
      ou: d.ou,
      detail: d.detail,
      jumeaux: d.jumeaux || [],
      regleScan: d.regleScan || null,
    };
    if (vus.has(e.id)) { collisions.push({ id: e.id, a: vus.get(e.id).titre, b: d.quoi }); continue; }
    vus.set(e.id, defaut);
  }

  /* LE BAROMÈTRE. Ce qui trompe l'utilisateur d'abord, puis ce qui est cassé, puis
     la dette. À gravité égale, le fichier n'entre pas en jeu : c'est l'ordre du
     bilan qui est conservé, celui que l'humain a lu. Jamais par nombre. */
  const file = [...vus.values()];
  file.forEach((d, i) => { d.rangBilan = i; });
  file.sort((a, b) => a.gravite - b.gravite || a.rangBilan - b.rangBilan);

  const tableau = lireTableauBilan(racine);
  const compte = { trompe: 0, 'cassé': 0, dette: 0 };
  for (const d of file) compte[d.niveau]++;
  const accord = !tableau ? null : {
    trompe: tableau.trompe === compte.trompe,
    'cassé': tableau['cassé'] === compte['cassé'],
    dette: tableau.dette === compte.dette,
  };

  return {
    date: new Date().toISOString(),
    racine,
    source: fs.existsSync(path.join(dossier(racine), 'scan.json')) ? 'scan.json' : 'dialogue.json',
    defauts: file,
    collisions,
    compte,
    bilan: tableau,
    accordAvecBilan: accord,
    concorde: accord ? Object.values(accord).every(Boolean) : null,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const racine = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
  if (!fs.existsSync(dossier(racine))) {
    console.error(`Pas de .backend/ dans ${racine}. Lancer d'abord le scan :\n  node scripts/couverture.mjs ${racine}`);
    process.exit(2);
  }
  const f = fileDeReparation(racine);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(f, null, 2)); process.exit(0); }

  console.log(`\n╔══ FILE DE RÉPARATION ─ ${path.basename(racine)}   (source : .backend/${f.source})`);
  console.log(`║  ${f.defauts.length} défauts · trompe ${f.compte.trompe} · cassé ${f.compte['cassé']} · dette ${f.compte.dette}`);
  if (f.bilan) {
    console.log(`║  BILAN.md dit : trompe ${f.bilan.trompe} · cassé ${f.bilan['cassé']} · dette ${f.bilan.dette}  → ${f.concorde ? 'concorde' : '⚠️ DIVERGE'}`);
  } else console.log(`║  ⚠️  BILAN.md absent : aucun contrôle croisé possible.`);
  const instables = f.defauts.filter((d) => !d.stable).length;
  if (instables) console.log(`║  ⚠️  ${instables} défauts sans identité stable.`);
  console.log(`╚══\n`);
  for (const d of f.defauts) {
    console.log(`  ${d.niveau.padEnd(7)} ${d.id.padEnd(26)} ${d.fichier}`);
    console.log(`          ${d.titre.slice(0, 110)}`);
  }
  console.log();
}

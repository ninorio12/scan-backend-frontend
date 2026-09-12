#!/usr/bin/env node
/**
 * empreintes.mjs — donner à chaque défaut une identité qui survit aux corrections.
 *
 * LE PROBLÈME, MESURÉ
 * Le scanner désigne « app/modules/parametres/page.tsx:348 ». On corrige le défaut de
 * la ligne 238 en ajoutant six lignes : le défaut de la ligne 348 devient 354. Le
 * scanner le resignale, l'orchestrateur croit à un nouveau défaut, le juge compare
 * contre le mauvais contrat, et la boucle tourne sur elle-même. Sur projet client A, une seule
 * correction de l'écran Paramètres décale trois des quatre défauts D2 du même fichier.
 *
 * LA SOLUTION
 * L'identité n'est jamais le numéro de ligne. Elle est le triplet
 *
 *      règle + fichier + ancre
 *
 * où l'ancre est, dans l'ordre de préférence :
 *   1. le symbole qualifié que le scanner a déjà nommé  (« parametres.enregistrer »)
 *   2. le symbole englobant, résolu en remontant le fichier depuis la ligne
 *      (« ParametresPage », « PhotoAgence »)
 *   3. la charge utile normalisée : le littéral qui EST le défaut
 *      (l'URL d'un fetch, le texte d'un toast, la valeur d'un defaultValue)
 *
 * Le numéro de ligne reste stocké, mais comme une AIDE À LA RECHERCHE, jamais comme
 * une identité : `relocaliser()` retrouve la ligne courante à partir du témoin, en
 * partant de l'ancienne ligne et en s'en éloignant par cercles concentriques.
 *
 *   node empreintes.mjs <repo>                    → calcule et écrit .backend/empreintes.json
 *   node empreintes.mjs <repo> --audit <f.json>   → à partir d'un audit déjà calculé
 *   node empreintes.mjs <repo> --diff             → compare à l'empreinte précédente
 *   node empreintes.mjs <repo> --json             → sortie machine
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const SCANNER = path.resolve(ICI, '..', 'scripts', 'audit-backend.mjs');

/* ── Normalisations ─────────────────────────────────────────────────────────
   Tout ce qui suit doit être stable face à un reformatage : un littéral qui
   passe de guillemets doubles à simples, une indentation qui change, un espace
   ajouté avant une parenthèse. On écrase donc la casse des espaces, pas le
   contenu : deux littéraux différents doivent rester différents. */

export function normaliserTexte(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Le témoin : la ligne de code elle-même, réduite à sa substance.
    Sert à la relocalisation, jamais à l'identité (une ligne peut se répéter). */
export function temoinDe(ligneTexte) {
  return normaliserTexte(ligneTexte)
    .replace(/["'`]/g, '"')          // les guillemets ne portent pas de sens
    .replace(/;\s*$/, '')
    .slice(0, 160);
}

/** La charge utile : le littéral qui EST le défaut, extrait du message du scanner.
    « onClick → toast("Informations enregistrées") »  → « Informations enregistrées »
    « appelle « /modules/parametres/etat » : … »       → « /modules/parametres/etat »
    « defaultValue="Sophie"   ← nom propre »           → « Sophie » */
export function chargeUtile(texte) {
  const t = String(texte);
  const motifs = [
    /«\s*([^»]+?)\s*»/,                       // le scanner cite entre chevrons
    /toast\(\s*["'`]([^"'`]+)["'`]/,          // le message annoncé
    /defaultValue\s*=\s*["'`]([^"'`]*)["'`]/, // la valeur en dur
    /value\s*=\s*["'`]([^"'`]+)["'`]/,
    /["'`](\/[\w./[\]@-]{3,})["'`]/,          // un chemin
  ];
  for (const re of motifs) {
    const m = t.match(re);
    if (m && m[1] !== undefined) return normaliserTexte(m[1]);
  }
  return null;
}

/* ── Le symbole englobant ──────────────────────────────────────────────────
   On remonte depuis la ligne jusqu'à la première déclaration nommée. C'est ce
   qui donne une ancre à un défaut qui n'a ni symbole qualifié ni littéral,
   typiquement un `<button>` sans action au milieu d'un composant. */

const DECLARATION = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/,
  /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
];

export function symboleEnglobant(lignes, indexLigne) {
  for (let i = Math.min(indexLigne, lignes.length - 1); i >= 0; i--) {
    for (const re of DECLARATION) {
      const m = lignes[i].match(re);
      if (m) return m[1];
    }
  }
  return null;
}

/* ── Parse d'un item de l'auditeur ─────────────────────────────────────────── */

/** « query  parametres.enregistrer  (convex/parametres.ts:59) »
    « app/modules/parametres/page.tsx:348  onClick → toast("…") »
    « app/modules/parametres/page.tsx  (30 champs, aucune lecture de source) »
    « projet-client-A  base de données présente, aucune sauvegarde… » (sans fichier) */
export function parserItem(texte) {
  const t = String(texte).split('\n')[0];
  const avecLigne = t.match(/([\w./@[\]()-]+\.\w{1,5}):(\d+)/);
  const sansLigne = avecLigne ? null : t.match(/([\w./@[\]()-]+\.(?:tsx?|jsx?|mjs|cjs|sql|prisma|sh|json|env\.example))/);
  /* La classe de caractères doit accepter les parenthèses des groupes de routes
     Next.js (« app/(app)/page.tsx »), mais l'auditeur écrit aussi ses chemins entre
     parenthèses (« query x.y (convex/x.ts:15) ») : sans ce nettoyage, le bail portait
     sur « (convex/x.ts » et aucun fichier réel ne lui correspondait. */
  const nettoyer = (s) => s && s.replace(/^[(]+/, '').replace(/[)]+$/, '');
  const fichier = nettoyer(avecLigne ? avecLigne[1] : sansLigne ? sansLigne[1] : null);
  const ligne = avecLigne ? Number(avecLigne[2]) : null;

  // Symbole qualifié explicitement nommé par le scanner : « module.fonction »
  const qualifie = t.match(/\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*(?:\(|$|\s)/);
  // On écarte les faux positifs du genre « page.tsx » ou « ctx.db »
  const symboleQualifie =
    qualifie && !/^(tsx?|jsx?|mjs|cjs|json|sh)$/.test(qualifie[2]) && !/^(ctx|q|db|args|api|internal)$/.test(qualifie[1])
      ? `${qualifie[1]}.${qualifie[2]}`
      : null;

  return { fichier, ligne, symboleQualifie, texte: normaliserTexte(t) };
}

/* ── Le calcul de l'empreinte ──────────────────────────────────────────────── */

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

export function empreinteDe({ regle, item, racine }) {
  const p = parserItem(item);
  const fichier = p.fichier || '(global)';
  let lignes = null;
  if (p.fichier) {
    try { lignes = fs.readFileSync(path.join(racine, p.fichier), 'utf8').split('\n'); } catch { lignes = null; }
  }

  const ligneTexte = lignes && p.ligne ? (lignes[p.ligne - 1] ?? '') : '';
  const charge = chargeUtile(p.texte) ?? chargeUtile(ligneTexte);
  const englobant = lignes && p.ligne ? symboleEnglobant(lignes, p.ligne - 1) : null;

  // L'ordre de préférence EST la robustesse : le symbole qualifié ne bouge que si
  // on renomme la fonction (auquel cas c'est bien un autre défaut) ; la charge
  // utile ne bouge que si on corrige le littéral (idem) ; le symbole englobant
  // est le dernier recours et le plus grossier, il regroupe plusieurs défauts du
  // même composant : on y ajoute donc la charge s'il y en a une.
  /* ⚠️ Le symbole englobant est le maillon faible, et c'est MESURÉ : après la
     correction de l'écran Paramètres d'projet client A, sept défauts non touchés avaient
     changé d'identité, parce que déclarer trois fonctions plus haut dans le
     fichier change la déclaration que l'on rencontre en remontant. La règle est
     donc : quand la charge utile est UNIQUE dans le fichier, elle suffit à elle
     seule et l'englobant n'entre pas dans l'ancre. On ne s'appuie sur lui que
     quand le même littéral apparaît plusieurs fois et qu'il faut les distinguer. */
  const occurrences = charge && lignes ? lignes.filter((l) => l.includes(charge)).length : 0;

  let ancre, sourceAncre;
  if (p.symboleQualifie) { ancre = p.symboleQualifie; sourceAncre = 'symbole-qualifie'; }
  else if (charge && occurrences === 1) { ancre = `«${charge}»`; sourceAncre = 'charge-unique'; }
  else if (charge && occurrences > 1 && lignes && p.ligne) {
    // Le même littéral plusieurs fois dans le fichier : on les distingue par leur
    // RANG d'apparition, pas par la déclaration d'à côté. Le rang ne bouge que si
    // on réordonne les occurrences ; l'englobant bougeait dès qu'on déclarait une
    // fonction plus haut.
    const rang = lignes.slice(0, p.ligne).filter((l) => l.includes(charge)).length;
    ancre = `«${charge}»#${rang}`; sourceAncre = 'charge-rang';
  }
  else if (charge) { ancre = `${englobant || '?'}«${charge}»`; sourceAncre = englobant ? 'englobant+charge' : 'charge'; }
  else if (englobant) { ancre = englobant; sourceAncre = 'englobant'; }
  else { ancre = `L${p.ligne ?? 0}`; sourceAncre = 'ligne-faute-de-mieux'; }

  return {
    id: `${regle}:${hash(`${fichier}#${ancre}`)}`,
    regle,
    fichier,
    ancre,
    sourceAncre,
    // Aides à la recherche, jamais à l'identité :
    ligneVue: p.ligne,
    temoin: ligneTexte ? temoinDe(ligneTexte) : null,
    charge,
    item: p.texte,
    // Un défaut dont l'ancre est un numéro de ligne n'a PAS d'identité stable.
    // On le dit au lieu de faire semblant : la boucle refusera de le traiter
    // en parallèle d'un autre défaut du même fichier.
    stable: sourceAncre !== 'ligne-faute-de-mieux',
  };
}

/* ── Relocalisation ────────────────────────────────────────────────────────── */

/** Retrouve la ligne courante d'un défaut après que le fichier a bougé.
    Stratégie : le symbole qualifié d'abord (une déclaration se retrouve par son
    nom), puis le témoin exact, en cercles concentriques autour de l'ancienne
    ligne pour ne pas attraper une répétition à l'autre bout du fichier. */
export function relocaliser(emp, texteFichier) {
  const lignes = texteFichier.split('\n');

  if (emp.sourceAncre === 'symbole-qualifie') {
    const nom = emp.ancre.split('.').pop();
    const re = new RegExp(`^\\s*export\\s+const\\s+${nom}\\s*[:=]`);
    for (let i = 0; i < lignes.length; i++) if (re.test(lignes[i])) return { ligne: i + 1, confiance: 'exacte' };
  }

  if (emp.temoin) {
    const cible = emp.temoin;
    const depart = Math.max(0, (emp.ligneVue || 1) - 1);
    const candidats = [];
    for (let i = 0; i < lignes.length; i++) if (temoinDe(lignes[i]) === cible) candidats.push(i + 1);
    if (candidats.length === 1) return { ligne: candidats[0], confiance: 'exacte' };
    if (candidats.length > 1) {
      candidats.sort((a, b) => Math.abs(a - depart) - Math.abs(b - depart));
      return { ligne: candidats[0], confiance: 'ambigue', autres: candidats.slice(1) };
    }
  }

  if (emp.charge) {
    const idx = lignes.findIndex((l) => l.includes(emp.charge));
    if (idx >= 0) return { ligne: idx + 1, confiance: 'approchee' };
  }

  return { ligne: null, confiance: 'perdue' };
}

/* ── Exécution ─────────────────────────────────────────────────────────────── */

function auditer(racine, fichierAudit) {
  if (fichierAudit) return JSON.parse(fs.readFileSync(fichierAudit, 'utf8'));
  try {
    return JSON.parse(execFileSync('node', [SCANNER, racine, '--json', '--full'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

export function calculer(racine, fichierAudit) {
  const audit = auditer(racine, fichierAudit);
  const vues = new Map();
  const collisions = [];
  for (const f of audit.findings || []) {
    for (const item of f.items || []) {
      const e = empreinteDe({ regle: f.id, item, racine });
      e.gravite = f.gravite;
      e.titre = String(f.titre || '').replace(/\s*\(.*/, '');
      if (vues.has(e.id)) { collisions.push({ id: e.id, a: vues.get(e.id).item, b: e.item }); continue; }
      vues.set(e.id, e);
    }
  }
  return {
    date: new Date().toISOString(),
    racine,
    stacks: audit.stacks,
    empreintes: [...vues.values()],
    collisions,
    total: (audit.findings || []).reduce((n, f) => n + f.items.length, 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const racine = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const res = calculer(racine, arg('--audit'));
  const dossier = path.join(racine, '.backend');
  const sortie = path.join(dossier, 'empreintes.json');

  let precedent = null;
  try { precedent = JSON.parse(fs.readFileSync(sortie, 'utf8')); } catch { /* première fois */ }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    const parStabilite = res.empreintes.reduce((a, e) => (a[e.sourceAncre] = (a[e.sourceAncre] || 0) + 1, a), {});
    console.log(`\n${res.empreintes.length} empreintes sur ${res.total} signalements  (${res.total - res.empreintes.length} doublons fusionnés)`);
    console.log(`stables : ${res.empreintes.filter((e) => e.stable).length} · instables : ${res.empreintes.filter((e) => !e.stable).length}`);
    for (const [k, v] of Object.entries(parStabilite).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
    if (res.collisions.length) console.log(`\n⚠️  ${res.collisions.length} collisions d'ancre (deux défauts, une identité) : la boucle les traitera ensemble.`);

    if (precedent && process.argv.includes('--diff')) {
      const avant = new Set(precedent.empreintes.map((e) => e.id));
      const apres = new Set(res.empreintes.map((e) => e.id));
      const partis = [...avant].filter((x) => !apres.has(x));
      const venus = [...apres].filter((x) => !avant.has(x));
      console.log(`\ndepuis ${precedent.date.slice(0, 16)} : −${partis.length} corrigés · +${venus.length} apparus`);
      for (const id of venus.slice(0, 10)) {
        const e = res.empreintes.find((x) => x.id === id);
        console.log(`   + ${id}  ${e.fichier}  ${e.item.slice(0, 70)}`);
      }
    }
  }

  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(sortie, JSON.stringify(res, null, 2) + '\n');
  if (!process.argv.includes('--json')) console.log(`\nécrit : ${path.relative(racine, sortie)}\n`);
}

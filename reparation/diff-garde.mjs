#!/usr/bin/env node
/**
 * diff-garde.mjs — le linter qui refuse un diff qui ÉTEINT un détecteur au lieu
 * de corriger le défaut.
 *
 * POURQUOI
 * Un agent à qui l'on dit « le recompte doit baisser » ne cherche pas de faille
 * subtile : il prend la route la moins chère vers le vert. Les six routes les moins
 * chères ont été constatées dans NOTRE PROPRE code, pas imaginées :
 *
 *   1. `// appelé par X`            éteint la règle A1 (l'auditeur a ANNOTATED ligne 135)
 *   2. renommer en old/archive/…    sort le dossier du scan entier (LEGACY ligne 34)
 *   3. `--only=A,B`                 masque un axe au recompte
 *   4. `disabled` sur un bouton     éteint D6 (« un bouton désactivé ne ment pas »)
 *   5. littéral → constante         éteint D5 (l'identité en dur change d'adresse)
 *   6. fichier vide créé            satisfait D9, et `touch scripts/backup.sh` satisfait I3
 *
 * S'y ajoutent les cinq mouvements du floor-guard d'Addy Osmani
 * (~/.agents/skills/constraint-driven-development/references/floor-guard.md), dont
 * on reprend la plomberie de diff et les codes de sortie plutôt que d'en écrire une
 * deuxième : suppression de vérificateur, travail inachevé, test rendu plus facile,
 * assertion retirée, seuil abaissé.
 *
 * ET SURTOUT LE BAIL (contrainte 1, payée par un incident réel : deux agents lancés
 * en parallèle se sont écrasés). Le périmètre n'est pas une consigne, c'est un
 * contrôle : tout fichier touché hors du bail révoque le LOT ENTIER.
 *
 *   node diff-garde.mjs <repo> --bail <bail.json> [--base <ref>] [--json]
 *   node diff-garde.mjs <repo> --bail-liste "a.ts,b.tsx" [--base <ref>]
 *
 * Codes : 0 propre · 1 au moins une violation (le lot est révoqué) · 2 le garde
 * n'a pas pu tourner. Un 2 ne doit JAMAIS se lire comme un 0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const BASE = arg('--base', 'HEAD');
const JSON_OUT = process.argv.includes('--json');

/* ── Plomberie git : lignes ajoutées, supprimées, ET fichiers non suivis ────
   Un garde qui ne lit que `git diff` rate les fichiers neufs. Or « créer un
   fichier vide » est précisément l'une des triches. */

function git(args) {
  try { return execFileSync('git', ['-C', RACINE, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

/* Les artefacts de la boucle elle-même ne sont pas des modifications du projet :
   le bail, l'état, les empreintes. Les compter contre le bail ferait refuser
   toutes les corrections honnêtes, ce qui est exactement le mode d'échec qu'on
   reproche aux gardes trop zélés. */
const ARTEFACTS = /(^|\/)(bail|contrat|etat|empreintes|lots|verdict)\.json$|(^|\/)\.backend\//;

function collecterDiff() {
  if (!git(['rev-parse', '--git-dir'])) return null;
  const suivi = git(['diff', '--unified=0', BASE, '--']) ?? '';
  const neufs = (git(['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean);
  let horsIndex = '';
  for (const f of neufs) {
    try {
      execFileSync('git', ['-C', RACINE, 'diff', '--no-index', '--unified=0', '/dev/null', f], { encoding: 'utf8' });
    } catch (e) { horsIndex += '\n' + (e.stdout || ''); }
  }
  return { texte: suivi + horsIndex, neufs };
}

/* `+++ b/app/page.tsx`, `--- /dev/null`, `+++ "b/un chemin avec espace.ts"`.
   Le préfixe a/ b/ n'est pas systématique (--no-index n'en met pas), d'où le
   découpage prudent : un `.slice(6)` naïf transformait /dev/null en « ev/null »
   et faisait révoquer tous les lots honnêtes. */
function cheminDeLigne(ligne) {
  let p = ligne.slice(4).trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  p = p.replace(/\t.*$/, '');
  if (p === '/dev/null' || !p) return null;
  return p.replace(/^[ab]\//, '');
}

function parser(texte) {
  const ajoutees = [], supprimees = [], fichiers = new Set(), renommages = [];
  let courant = null, ligneNeuve = 0;
  for (const ligne of texte.split('\n')) {
    if (ligne.startsWith('+++ ')) {
      courant = cheminDeLigne(ligne);
      if (courant) fichiers.add(courant);
      continue;
    }
    if (ligne.startsWith('--- ')) { const a = cheminDeLigne(ligne); if (a) fichiers.add(a); continue; }
    if (ligne.startsWith('rename from ')) renommages.push({ de: ligne.slice(12).trim() });
    if (ligne.startsWith('rename to ') && renommages.length) renommages[renommages.length - 1].vers = ligne.slice(10).trim();
    /* L'en-tête de section donne le VRAI numéro de ligne dans le fichier d'après.
       Sans lui, deux lignes ajoutées dans deux sections éloignées se retrouvent
       voisines dans le tableau, et un contrôle de voisinage devient faux : c'est
       comme ça que la triche du bouton éteint est passée la première fois. */
    const hunk = ligne.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { ligneNeuve = Number(hunk[1]); continue; }
    if (ligne.startsWith('+') && !ligne.startsWith('+++')) ajoutees.push({ fichier: courant, texte: ligne.slice(1), ligne: ligneNeuve++ });
    else if (ligne.startsWith('-') && !ligne.startsWith('---')) supprimees.push({ fichier: courant, texte: ligne.slice(1) });
  }
  return { ajoutees, supprimees, fichiers: [...fichiers], renommages };
}

/* ── Les motifs ────────────────────────────────────────────────────────────
   Seule partie à adapter d'un écosystème à l'autre. La plomberie ne bouge pas. */

// Triche 1 : l'annotation qui éteint A1. Le motif est celui de l'auditeur lui-même,
// copié depuis scripts/audit-backend.mjs ligne 135 — s'il change là-bas, il change ici.
const ANNOTATION_A1 = /\/\/\s*(appel|called|invoqu|expos|utilis)/i;
// Triche 2 : le dossier qui sort du scan. Motif copié de LEGACY, ligne 34.
const DOSSIER_MORT = /(^|[\\/])(_?legacy|archive|old|backup|deprecated)[\\/]/i;
// Triche 3 : l'axe masqué.
const AXE_MASQUE = /--only=|--skip=|--exclude=[A-Z]\d|ONLY=[A-Z]\d/;
// Triche 4 : le bouton éteint plutôt que branché.
const BOUTON_ETEINT = /\bdisabled\b(?!\s*=\s*\{?\s*(?:false|\w+\.(?:pending|loading)|enCours|chargement))/;
// Les cinq du floor-guard.
const SUPPRESSIONS = /@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|# *noqa|# *type: *ignore|istanbul ignore|nosemgrep|gitleaks:allow|Stryker disable/;
const INACHEVE = /throw new (Error|NotImplemented).*[Nn]ot implemented|catch\s*\(\w*\)\s*\{\s*\}|catch\s*\{\s*\}|\bTODO\b|\bFIXME\b|pas encore impl/i;
const TESTS_ETEINTS = /\.(skip|todo)\b|\bxit\(|\bxdescribe\(|@pytest\.mark\.skip|t\.Skip\(/;
// Les fichiers qui n'ont le droit d'exister que s'ils font quelque chose.
const FICHIERS_ALIBIS = /(^|\/)(error|loading|not-found|global-error)\.(tsx?|jsx?)$|(^|\/)(backup|sauvegarde|restore|restauration)[\w.-]*\.(sh|mjs|ts|js)$/i;
// Le squelette du skill lui-même : un diff qui le touche ne corrige pas un projet.
const OUTILLAGE = /(^|\/)\.claude\/skills\/|(^|\/)scripts\/(audit-backend|gardes|rules-)/;

/* ── Le contrôle ───────────────────────────────────────────────────────────── */

function controler({ bail, diff }) {
  const { ajoutees, supprimees, fichiers, renommages } = diff;
  const violations = [];
  const flag = (regle, fichier, texte, explication) =>
    violations.push({ regle, fichier: fichier || '(inconnu)', texte: String(texte).trim().slice(0, 140), explication });

  /* 0. LE BAIL. En premier parce qu'il révoque le lot entier : inutile d'analyser
        le contenu d'un diff qui n'avait pas le droit d'exister. */
  if (bail) {
    const autorise = (f) => ARTEFACTS.test(f) || bail.fichiers.some((b) =>
      b === f || (b.endsWith('/') && f.startsWith(b)) || (b.endsWith('/**') && f.startsWith(b.slice(0, -2))));
    for (const f of fichiers) if (!autorise(f)) {
      flag('hors-bail', f, `le bail ${bail.lot} ne couvre pas ce fichier`,
        `Le lot ${bail.lot} a le droit de toucher : ${bail.fichiers.join(', ')}. Tout le lot est révoqué.`);
    }
  }

  /* 1-6 : les triches constatées chez nous.
     ⚠️ Les artefacts de la boucle sont exclus de l'ANALYSE, pas seulement du bail :
     empreintes.json cite le code fautif du projet (« catch {} », « TODO »…) et le
     garde se mettait à refuser le lot à cause de son propre rapport. Un garde qui
     lit ses propres notes comme du code produit exactement le faux positif qu'on
     reproche aux règles. */
  for (const { fichier, texte } of ajoutees) {
    if (ARTEFACTS.test(fichier || '')) continue;
    if (OUTILLAGE.test(fichier || '')) {
      flag('outillage-modifie', fichier, texte, "Le diff modifie l'auditeur ou le skill. Corriger le projet, pas l'instrument qui mesure.");
      continue;
    }
    if (ANNOTATION_A1.test(texte)) {
      flag('annotation-qui-eteint', fichier, texte,
        "L'annotation « appelé par … » éteint la règle A1 sans brancher quoi que ce soit. Si l'appelant existe, il doit être dans le diff ; sinon la fonction est morte et se supprime.");
    }
    if (AXE_MASQUE.test(texte)) {
      flag('axe-masque', fichier, texte, "Masquer un axe avant de recompter revient à déclarer que rien ne casse après avoir éteint le voyant.");
    }
    if (SUPPRESSIONS.test(texte)) flag('verificateur-eteint', fichier, texte, 'Un vérificateur mis en sourdine n\'est pas un défaut corrigé.');
    if (INACHEVE.test(texte)) flag('travail-inacheve', fichier, texte, 'Un stub, un catch vide ou un TODO ajouté ferme la règle sans faire le travail.');
    if (TESTS_ETEINTS.test(texte)) flag('test-rendu-facile', fichier, texte, 'Un test éteint ne prouve plus rien.');
  }

  /* 2 bis : le renommage qui sort du scan. On regarde les renommages déclarés ET
     l'apparition de chemins morts parmi les fichiers touchés. */
  for (const r of renommages) {
    if (!DOSSIER_MORT.test(r.de || '') && DOSSIER_MORT.test(r.vers || '')) {
      flag('mise-au-placard', r.vers, `${r.de} → ${r.vers}`,
        "Déplacer du code vivant dans old/archive/legacy/backup le sort du scan entier sans rien réparer.");
    }
  }
  for (const f of fichiers) {
    if (DOSSIER_MORT.test(f) && !renommages.some((r) => r.vers === f)) {
      const etaitLa = git(['cat-file', '-e', `${BASE}:${f}`]) !== null;
      if (!etaitLa) flag('mise-au-placard', f, 'fichier neuf dans un dossier hors scan',
        "Un fichier créé sous old/archive/legacy/backup n'est jamais audité : c'est une cachette, pas une correction.");
    }
  }

  /* 4 : `disabled` ajouté sans branchement À CÔTÉ.
     ⚠️ La première version regardait tout le fichier : il suffisait qu'une autre
     correction du même fichier contienne un `fetch(` pour que le `disabled` posé
     ailleurs passe. Mesuré en sabotant un lot réel : la triche est passée. Le
     voisinage est donc LOCAL, et compté en LIGNES DU FICHIER (±6), pas en entrées
     du diff : deux sections éloignées se touchent dans le tableau des ajouts. */
  const BRANCHEMENT = /on[A-Z]\w+\s*=\s*\{|useMutation|useAction|fetch\(|router\.(push|replace)|await\s+\w+\(/;
  for (let i = 0; i < ajoutees.length; i++) {
    const { fichier, texte } = ajoutees[i];
    if (ARTEFACTS.test(fichier || '') || !BOUTON_ETEINT.test(texte)) continue;
    const ici = ajoutees[i].ligne ?? 0;
    const voisins = ajoutees.filter((a) => a.fichier === fichier && Math.abs((a.ligne ?? -999) - ici) <= 6);
    if (!voisins.some((a) => BRANCHEMENT.test(a.texte))) {
      flag('bouton-eteint', fichier, texte, "Ajouter `disabled` fait taire la règle des boutons morts sans donner d'action au bouton.");
    }
  }

  /* 5 : le littéral déplacé dans une constante. Le défaut D5 (identité en dur) ne
        disparaît pas parce que la chaîne a changé d'adresse : on compare les
        littéraux disparus des lignes supprimées à ceux réapparus dans une
        déclaration de constante. */
  const litterauxDe = (s) => [...String(s).matchAll(/["'`]([^"'`\n]{4,})["'`]/g)].map((m) => m[1]);
  const disparus = new Set();
  for (const s of supprimees) if (!ARTEFACTS.test(s.fichier || '')) for (const l of litterauxDe(s.texte)) disparus.add(l);
  for (const { fichier, texte } of ajoutees) {
    if (!/^\s*(?:export\s+)?const\s+[A-Z_][\w$]*\s*(?::[^=]+)?=\s*["'`]/.test(texte)) continue;
    for (const l of litterauxDe(texte)) if (disparus.has(l)) {
      flag('litteral-deplace', fichier, texte,
        `Le littéral « ${l.slice(0, 40)} » a seulement changé d'adresse. Une identité en dur dans une constante reste une identité en dur.`);
    }
  }

  /* 6 : le fichier alibi. Créé pour satisfaire une règle de présence, vide ou
        quasi vide. Le seuil est bas exprès : un vrai écran d'erreur fait plus de
        cinq lignes utiles, un vrai script de sauvegarde aussi. */
  for (const f of fichiers) {
    if (!FICHIERS_ALIBIS.test(f)) continue;
    let contenu = '';
    try { contenu = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
    const utiles = contenu.split('\n')
      .map((l) => l.replace(/\/\/.*$|#.*$/, '').trim())
      .filter((l) => l && l !== '{' && l !== '}' && !/^\/\*|\*\/|^\*/.test(l));
    if (utiles.length < 5) {
      flag('fichier-alibi', f, `${utiles.length} ligne(s) utile(s)`,
        "Le fichier existe, donc la règle de présence se tait. Il ne fait rien, donc l'incident qu'elle prévenait arrivera quand même.");
    }
  }

  /* Floor-guard : assertion retirée d'un test qui reste en place. */
  for (const { fichier, texte } of supprimees) {
    if (ARTEFACTS.test(fichier || '')) continue;
    if (/\.(test|spec)\.|_test\.|(^|\/)tests?\//.test(fichier || '') && /\b(expect|assert|should|toBe|toEqual)\b/.test(texte)) {
      flag('assertion-retiree', fichier, texte, 'Le test survit, sa preuve non.');
    }
  }

  /* Suppression de masse : un lot qui retire beaucoup et n'ajoute presque rien
     est soit une vraie suppression de code mort (légitime, et le bail le dit),
     soit un nettoyage au bulldozer. On ne le refuse pas, on l'expose. */
  const avertissements = [];
  if (supprimees.length > 80 && ajoutees.length < supprimees.length / 10) {
    avertissements.push({
      regle: 'suppression-de-masse',
      texte: `${supprimees.length} lignes retirées pour ${ajoutees.length} ajoutées`,
      explication: "Légitime si le bail porte sur du code mort. À vérifier par le juge, jamais à accepter sur parole.",
    });
  }

  return { violations, avertissements };
}

/* ── Exécution ─────────────────────────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const diffBrut = collecterDiff();
  if (!diffBrut) {
    console.error(`diff-garde : ${RACINE} n'est pas un dépôt git. Le garde ne peut pas tourner.`);
    process.exit(2);
  }

  let bail = null;
  const bailFichier = arg('--bail');
  const bailListe = arg('--bail-liste');
  if (bailFichier) {
    try { bail = JSON.parse(fs.readFileSync(bailFichier, 'utf8')); }
    catch (e) { console.error(`diff-garde : bail illisible (${bailFichier}) : ${e.message}`); process.exit(2); }
  } else if (bailListe) {
    bail = { lot: 'ad-hoc', fichiers: bailListe.split(',').map((s) => s.trim()).filter(Boolean) };
  }

  const diff = parser(diffBrut.texte);
  const { violations, avertissements } = controler({ bail, diff });

  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, bail: bail?.lot ?? null, fichiers: diff.fichiers, violations, avertissements }, null, 2));
  } else if (violations.length === 0) {
    console.log(`diff-garde : propre · ${diff.fichiers.length} fichier(s) touché(s)${bail ? `, tous dans le bail ${bail.lot}` : ''}`);
    for (const a of avertissements) console.log(`  ⚠️  [${a.regle}] ${a.texte}\n      ${a.explication}`);
  } else {
    console.error(`diff-garde : ${violations.length} violation(s). Le lot est REFUSÉ.\n`);
    const parRegle = new Map();
    for (const v of violations) { if (!parRegle.has(v.regle)) parRegle.set(v.regle, []); parRegle.get(v.regle).push(v); }
    for (const [regle, vs] of parRegle) {
      console.error(`  [${regle}] ${vs.length}×`);
      console.error(`      ${vs[0].explication}`);
      for (const v of vs.slice(0, 6)) console.error(`      · ${v.fichier} : ${v.texte}`);
      if (vs.length > 6) console.error(`      · … ${vs.length - 6} autres`);
      console.error();
    }
    console.error('Chacune est un mouvement qui baisse la barre au lieu de la franchir.');
  }
  process.exit(violations.length ? 1 : 0);
}

export { controler, parser, collecterDiff };

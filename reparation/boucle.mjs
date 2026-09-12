#!/usr/bin/env node
/**
 * boucle.mjs — l'orchestrateur : du bilan à la correction prouvée, sans main humaine.
 *
 * CE QUI MANQUAIT, ET C'EST LA SEULE CHOSE QUI COMPTAIT
 * Les pièces existaient toutes et n'étaient jamais enchaînées. `ouvrir` écrivait un
 * contrat vide, puis un humain lançait l'agent à la main, puis `juger` rendait
 * INJUGEABLE parce que le contrat était vide. La boucle n'a donc jamais tourné. Ce
 * fichier ferme la chaîne : entrée du bilan → contrat dérivé → lot disjoint dans un
 * worktree → OUVRIER RÉELLEMENT LANCÉ → juge qui n'est pas l'ouvrier → fusion ou
 * révocation → défaut rejeté remis en file AVEC son motif.
 *
 * LES CINQ CONTRAINTES, CHACUNE PAYÉE PAR UN INCIDENT
 *
 * 1. L'ENTRÉE EST LE BILAN. Pas `audit-backend.mjs`, pas une liste écrite à la main :
 *    `.backend/BILAN.md` et les JSON qui le nourrissent, et l'ordre est celui du
 *    baromètre (trompe, puis cassé, puis dette), jamais le nombre de défauts par
 *    fichier. Voir entree.mjs.
 *
 * 2. PÉRIMÈTRES DISJOINTS, IMPOSÉS MÉCANIQUEMENT. Deux agents lancés en parallèle se
 *    sont écrasés. La consigne ne suffit pas : chaque lot reçoit son propre worktree
 *    git, donc son propre répertoire sur le disque, et un bail écrit. À la sortie,
 *    `git diff --name-only` est confronté au bail ; un seul fichier hors bail révoque
 *    le lot ENTIER. Pas de rattrapage partiel : un lot qui a débordé a pu écrire
 *    n'importe quoi, on ne sait plus ce qui est sûr dedans.
 *
 * 3. IDENTITÉ AVANT BOUCLE. Les défauts sont appelés par leur empreinte, jamais par
 *    leur numéro de ligne, que la première correction décale. Voir empreintes.mjs.
 *
 * 4. LE JUGE N'EST JAMAIS L'OUVRIER. L'agent qui corrige ne rend pas de verdict : le
 *    mot « ACCEPTÉ » ne sort jamais de sa bouche. Le juge est un contexte FRAIS qui
 *    reçoit trois choses et rien d'autre : le contrat, le diff, le résultat des
 *    invariants. Il ne voit ni le raisonnement de l'ouvrier (il en hériterait la
 *    conviction), ni le recompte du scanner (l'ouvrier peut le faire taire).
 *
 * 5. UN INVARIANT INDÉPENDANT DU SCANNER. Le recompte ne prouve rien puisque l'ouvrier
 *    peut faire taire le scanner. Il est mesuré et affiché, mais il n'ACCEPTE jamais
 *    seul : l'invariant décide. Voir invariants.mjs et diff-garde.mjs.
 *
 *   node boucle.mjs <repo> preparer          empreintes, contrats, découpe en lots
 *   node boucle.mjs <repo> lots              les lots, leur bail, leur contrat
 *   node boucle.mjs <repo> ouvrir <lot>      worktree + bail + contrat + brief
 *   node boucle.mjs <repo> corriger <lot>    lance l'OUVRIER (sous-agent) dans le bail
 *   node boucle.mjs <repo> juger <lot>       garde + typage + recompte + invariants + juge
 *   node boucle.mjs <repo> fermer <lot>      retire le worktree
 *   node boucle.mjs <repo> tourner           TOUT, sans intervention humaine
 *
 *   --lots=N        s'arrêter après N lots      --sec          n'exécute aucun agent
 *   --modele=X      modèle des agents            --essais=N     tentatives par lot (2)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileDeReparation } from './entree.mjs';
import { contratDe, fondationAuth } from './contrats.mjs';
import { verifierTous } from './invariants.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const SKILL = path.resolve(ICI, '..');
const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const CMD = process.argv[3] || 'preparer';
const NOM_LOT = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
const OPT = (n, d) => { const f = process.argv.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=').slice(1).join('=') : d; };
const A = (n) => process.argv.includes(`--${n}`);

const DOSSIER = path.join(RACINE, '.backend');
const PLAN = path.join(DOSSIER, 'lots.json');
const ETAT = path.join(DOSSIER, 'boucle-etat.json');
/* Les chantiers ne vivent PAS à côté du projet audité, et c'est une leçon payée :
   posé sous `~/.claude/`, un worktree hérite du statut « fichier sensible » et
   l'ouvrier se voit refuser toute écriture — il rend alors un rapport poli qui dit
   qu'il n'a rien pu faire, ce qui ressemble à s'y méprendre à un lot vide. Les
   chantiers vont donc dans un répertoire temporaire, réglable. */
const CHANTIERS = path.resolve(OPT('chantiers', process.env.BOUCLE_CHANTIERS
  || path.join(os.tmpdir(), 'boucle-chantiers', path.basename(RACINE))));
const MODELE = OPT('modele', 'sonnet');
const ESSAIS = Number(OPT('essais', 2));
const SEC = A('sec');

/* Tout ce que la boucle écrit dans un projet audité va sous `.backend/` — y compris
   dans le chantier. Posés à la racine du worktree, le brief et le journal de
   l'ouvrier comptaient comme des fichiers hors bail et révoquaient le lot avant
   même qu'on regarde le code : le garde refusait la boucle à cause de ses propres
   papiers. */
const ATELIER = (chantier) => path.join(chantier, '.backend', 'boucle');

const git = (args, cwd = RACINE) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const gitMuet = (args, cwd = RACINE) => { try { return git(args, cwd); } catch { return null; } };
/* ⚠️ `git()` coupe les blancs de fin — commode pour un `rev-parse`, fatal pour un
   patch : `git apply` refuse « corrupt patch » un diff privé de son dernier saut de
   ligne. La première boucle complète est morte là, après avoir fait tout le travail. */
const gitBrut = (args, cwd = RACINE) => { try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };

/* ══ 1 · DÉCOUPE EN LOTS DISJOINTS ═══════════════════════════════════════════
   L'unité est le FICHIER, pas la règle : on ouvre un fichier une fois et on y
   corrige tout. Découper par règle ferait rouvrir vingt fois les mêmes fichiers et
   surtout ferait se marcher dessus deux agents sur le même fichier.

   Le bail peut s'étendre aux fichiers JUMEAUX que le scanner a nommés (l'écran et
   la requête qui l'alimente) — mais seulement à ceux qu'aucun autre lot ne réclame.
   Un fichier appartient à exactement un lot, et c'est vérifié, pas espéré. */

function decouper(contrats) {
  const parFichier = new Map();
  for (const c of contrats) {
    if (!parFichier.has(c.fichier)) parFichier.set(c.fichier, []);
    parFichier.get(c.fichier).push(c);
  }

  const proprietaires = new Set(parFichier.keys());   // un fichier porteur n'est jamais un « extra »
  const reserves = new Set();
  const lots = [];

  /* L'ordre du baromètre : le lot hérite de la gravité de son défaut le plus grave,
     puis du rang du bilan. Jamais du nombre de défauts : le fichier le plus bruyant
     est presque toujours le moins coûteux pour le client. */
  const rangs = [...parFichier.entries()].map(([fichier, cs]) => ({
    fichier, cs,
    gravite: Math.min(...cs.map((c) => c.gravite)),
    rang: Math.min(...cs.map((c) => contrats.indexOf(c))),
  })).sort((a, b) => a.gravite - b.gravite || a.rang - b.rang);

  for (const { fichier, cs, gravite } of rangs) {
    const extras = [];
    for (const c of cs) {
      for (const j of c.jumeauxFichiers || []) {
        if (j === fichier || proprietaires.has(j) || reserves.has(j)) continue;
        reserves.add(j); extras.push(j);
      }
    }
    lots.push({
      nom: fichier.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
      fichier,
      gravite,
      niveau: cs[0].niveau,
      bail: { lot: fichier, fichiers: [fichier, ...extras] },
      jugeables: cs.filter((c) => !c.injugeable).length,
      injugeables: cs.filter((c) => c.injugeable).length,
      contrats: cs,
      etat: 'à ouvrir',
      essais: 0,
      motifs: [],
    });
  }

  /* La preuve de disjonction, faite ici et pas promise : aucun fichier dans deux baux. */
  const vus = new Map();
  for (const l of lots) for (const f of l.bail.fichiers) {
    if (vus.has(f)) throw new Error(`découpe non disjointe : ${f} est dans ${vus.get(f)} et ${l.nom}`);
    vus.set(f, l.nom);
  }
  return lots;
}

/** Les fichiers cités dans les « jumeaux » d'un constat : « convex/biens.ts:145 argument ville ». */
function jumeauxFichiers(d) {
  const out = new Set();
  for (const j of d.jumeaux || []) {
    const m = String(j).match(/([\w./@[\]()-]+\.(?:tsx?|jsx?|mjs|cjs))/);
    if (m) out.add(m[1].replace(/^[(]+/, ''));
  }
  out.delete(d.fichier);
  return [...out];
}

/* ══ 2 · LE BRIEF DE L'OUVRIER ═══════════════════════════════════════════════
   Il reçoit : le contrat de SES défauts, son bail, les invariants qu'il devra
   passer, et la liste explicite des triches interdites. Pas le rapport complet du
   scanner : il y lirait les autres défauts et sortirait de son bail. Pas le mot
   « verdict » : il corrige, il ne juge pas. */

const TRICHES = `
INTERDITS ABSOLUS — chacun a déjà été commis ici, et le linter du juge les refuse un par un :
1. Annoter (« // appelé par X », « // utilisé dans Y ») pour faire taire un détecteur.
2. Renommer ou déplacer un fichier vers old/ archive/ legacy/ backup/ deprecated/.
3. Ajouter --only= / --skip= / --exclude= quelque part pour masquer un axe au recompte.
4. Poser \`disabled\` sur un bouton au lieu de lui donner une action.
5. Déplacer un littéral en dur dans une constante : c'est la même valeur inventée à une autre adresse.
6. Créer un fichier vide ou quasi vide pour satisfaire une règle de présence.
7. @ts-ignore, @ts-nocheck, eslint-disable, biome-ignore, # noqa : éteindre un vérificateur n'est pas corriger.
8. Ajouter TODO / FIXME / « pas encore implémenté » / un catch vide : un travail inachevé ferme la règle sans faire le travail.
9. Retirer une assertion d'un test, ou marquer un test .skip / .todo.
10. Toucher un fichier hors du bail : cela révoque le LOT ENTIER, y compris le travail juste.
11. Modifier l'outillage d'audit (scripts/audit-backend.mjs, gardes, rules-*) : on corrige le projet, pas l'instrument qui mesure.
`.trim();

function briefOuvrier(lot, contrats, extra = '') {
  const l = [];
  l.push(`Tu es l'OUVRIER d'un lot de réparation. Tu corriges du code, tu ne rends AUCUN verdict :`);
  l.push(`un autre agent, en contexte frais, jugera ton diff contre le contrat ci-dessous. Ne dis ni`);
  l.push(`« accepté », ni « corrigé », ni « validé » : dis ce que tu as changé, et c'est tout.\n`);
  l.push(`RÉPERTOIRE DE TRAVAIL : le dossier courant. C'est une copie jetable du projet, dans un`);
  l.push(`worktree git à part. Tu peux LIRE tout le projet ; tu ne peux ÉCRIRE que dans ton bail.\n`);
  l.push(`═══ TON BAIL — les seuls fichiers que tu as le droit de modifier ═══`);
  for (const f of lot.bail.fichiers) l.push(`  · ${f}`);
  l.push(`\nSi la correction juste exige de toucher un fichier hors de cette liste : NE LE TOUCHE PAS.`);
  l.push(`Écris à la place \`.backend/boucle/blocage.md\`, qui dit quel fichier il faudrait et pourquoi.`);
  l.push(`Un lot qui déborde est révoqué en entier, ton travail juste compris.\n`);
  l.push(`═══ LES DÉFAUTS À CORRIGER (${contrats.length}) ═══`);
  for (const [i, c] of contrats.entries()) {
    l.push(`\n── ${i + 1}. [${c.niveau}] empreinte ${c.id}`);
    l.push(`   OÙ       ${c.ou}`);
    l.push(`   CONSTAT  ${c.constat}`);
    if (c.detail) l.push(`   DÉTAIL   ${c.detail}`);
    l.push(`   ATTENDU  ${c.attendu}`);
    l.push(`   PREUVE   le juge rejouera, sans te demander ton avis :`);
    for (const inv of c.invariants) l.push(`            · ${inv.nom}   (${inv.type})`);
  }
  l.push(`\n═══ CE QUI SERA MESURÉ ═══`);
  l.push(`· Le linter anti-triche sur ton diff (liste ci-dessous).`);
  l.push(`· Le typage : aucune erreur nouvelle par rapport à l'état de départ.`);
  l.push(`· Les invariants ci-dessus, rejoués sur ton arbre.`);
  l.push(`· Le recompte par empreintes : ces empreintes doivent disparaître ET aucune nouvelle ne doit apparaître.`);
  l.push(`\n${TRICHES}`);
  l.push(`\n═══ MÉTHODE ═══`);
  l.push(`Lis d'abord les fichiers concernés en entier. Corrige la CAUSE, pas le symptôme.`);
  l.push(`Reste minimal : un diff large est un diff que le juge ne peut pas relire.`);
  l.push(`Si un défaut te paraît être un faux signalement, ne le maquille pas : laisse-le tel quel`);
  l.push(`et écris pourquoi dans \`.backend/boucle/blocage.md\`. Un « je ne corrige pas, et voici pourquoi » est un`);
  l.push(`résultat ; une correction cosmétique qui fait taire la règle n'en est pas un.`);
  if (extra) l.push(`\n═══ ⚠️ TENTATIVE PRÉCÉDENTE REFUSÉE ═══\n${extra}\nCorrige CE motif. Ne recommence pas à l'identique.`);
  l.push(`\nQuand tu as fini, résume en cinq lignes maximum ce que tu as changé et pourquoi.`);
  return l.join('\n');
}

/* ══ 3 · LANCER UN AGENT ═════════════════════════════════════════════════════
   L'ouvrier tourne dans le worktree, sans Bash (il n'a rien à exécuter) et sans
   accès réseau : ses outils sont Read, Edit, Write, Grep, Glob. `--restricted`
   confine en plus les outils de fichier au répertoire de travail : c'est une
   deuxième barrière, au cas où le bail serait mal écrit. */

function lancerAgent({ invite, cwd, outils, schema, budget = 4, etiquette }) {
  if (SEC) return { sec: true, texte: '(--sec : aucun agent lancé)', cout: 0 };
  const args = ['-p', '--model', MODELE, '--output-format', 'json', '--restricted',
    '--tools', outils, '--permission-mode', 'acceptEdits', '--no-session-persistence',
    '--max-budget-usd', String(budget), '--strict-mcp-config'];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const t0 = Date.now();
  let brut;
  try {
    brut = execFileSync('claude', args, { cwd, input: invite, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1800000 });
  } catch (e) {
    return { erreur: `l'agent ${etiquette} n'a pas pu tourner : ${String(e.message).slice(0, 300)}`, texte: e.stdout || '', cout: 0, ms: Date.now() - t0 };
  }
  let o; try { o = JSON.parse(brut); } catch { return { erreur: 'sortie de l’agent illisible', texte: brut.slice(0, 2000), cout: 0 }; }
  return {
    texte: String(o.result ?? ''),
    cout: o.total_cost_usd ?? 0,
    tours: o.num_turns ?? null,
    erreur: o.is_error ? `l'agent ${etiquette} a fini en erreur (${o.subtype || '?'})` : null,
    ms: Date.now() - t0,
  };
}

/* ══ 4 · LE TYPAGE, EN DIFFÉRENTIEL ══════════════════════════════════════════
   Le projet figé n'a pas ses dépendances installées : `tsc` y sort des centaines
   d'erreurs « Cannot find module react » qui n'ont rien à voir avec la correction.
   Un typecheck binaire refuserait donc tous les lots, honnêtes compris. On compare
   la SIGNATURE des erreurs (fichier + code + message, sans numéro de ligne) avant
   et après : ce qui compte est qu'aucune erreur NOUVELLE n'apparaisse. */

/* ⚠️ Le compilateur est appelé par son CHEMIN, jamais par `npx`. Mesuré : le
   chantier vit dans un répertoire temporaire, `npx` n'y trouve aucun node_modules
   en remontant, échoue en silence, et la fonction rendait « 0 erreur ». Un
   vérificateur qui ne tourne pas et rend zéro est pire qu'absent : il dit que tout
   va bien. On distingue donc « aucune erreur » de « n'a pas pu tourner ». */

const TSC = ['node_modules/typescript/bin/tsc', 'node_modules/.bin/tsc']
  .map((p) => path.join(SKILL, p)).find((p) => fs.existsSync(p));

function signaturesTsc(repo) {
  if (!TSC) return { arun: false, raison: 'typescript introuvable dans le skill', sigs: new Map() };
  let sortie = '', code = 0;
  try { sortie = execFileSync('node', [TSC, '--noEmit'], { cwd: repo, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status ?? -1; sortie = [e.stdout, e.stderr].filter(Boolean).join('\n'); }
  if (code === -1 && !/error TS\d+/.test(sortie)) return { arun: false, raison: `tsc n'a pas pu tourner : ${sortie.slice(0, 120)}`, sigs: new Map() };
  const sigs = new Map();
  for (const ligne of sortie.split('\n')) {
    const m = ligne.match(/^(.+?)\((\d+),(\d+)\):\s+(error\s+TS\d+):\s+(.*)$/);
    if (!m) continue;
    sigs.set(`${m[1]} ${m[4]} ${m[5]}`, 1);
  }
  return { arun: true, sigs };
}

let SIGS_BASE = null;
function typageDifferentiel(chantier) {
  if (!fs.existsSync(path.join(RACINE, 'tsconfig.json'))) return { ok: true, mesure: 'pas de tsconfig.json : typage non mesuré', nouvelles: [] };
  if (!SIGS_BASE) SIGS_BASE = signaturesTsc(RACINE);
  if (!SIGS_BASE.arun) return { ok: true, mesure: `typage non mesuré (${SIGS_BASE.raison})`, nouvelles: [] };
  const apres = signaturesTsc(chantier);
  if (!apres.arun) return { ok: true, mesure: `typage non mesuré dans le chantier (${apres.raison})`, nouvelles: [] };
  const nouvelles = [...apres.sigs.keys()].filter((s) => !SIGS_BASE.sigs.has(s));
  return {
    ok: nouvelles.length === 0,
    mesure: `${apres.sigs.size} signature(s) d'erreur de typage contre ${SIGS_BASE.sigs.size} au départ · ${nouvelles.length} nouvelle(s)`,
    nouvelles: nouvelles.slice(0, 8),
  };
}

/* ══ 4 bis · LA SURFACE PUBLIQUE DU BAIL ═════════════════════════════════════
   LE TROU QUE CE CONTRÔLE BOUCHE, ET IL A ÉTÉ MESURÉ. Un lot accepté par les
   invariants ET par le juge a renommé `valeurTotale` en `valeurTotaleParDevise`
   dans `convex/proprietaires.ts`. L'écran qui le lit vit dans un AUTRE fichier,
   donc hors du bail : l'ouvrier n'avait pas le droit d'y toucher, le juge ne le
   voyait pas dans le diff, et le typage différentiel est aveugle sur un projet
   dont les dépendances ne sont pas installées (« Cannot find module 'convex/react' »
   masque tout ce qui suit). Résultat : un écran qui affiche `undefined`, c'est-à-dire
   exactement la classe de panne que ce skill existe pour trouver.

   Le contrôle est mécanique et ne demande rien à personne : ce que le bail
   EXPORTAIT et ce qu'il RENDAIT avant doit exister encore, ou bien tous ceux qui
   s'en servent doivent être dans le bail. Le bail protège des collisions ; il ne
   doit pas servir d'alibi pour casser le voisin. */

function surfaceDe(texte) {
  const noms = new Set();
  for (const m of texte.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) noms.add(m[1]);
  /* Les clés rendues : ce que l'appelant lit par un point. On ne descend qu'au
     premier niveau du `return { … }` — au-delà, le bruit dépasse le signal. */
  for (const m of texte.matchAll(/\breturn\s*\{/g)) {
    const bloc = texte.slice(m.index + m[0].length - 1);
    let n = 0, fin = bloc.length;
    for (let i = 0; i < bloc.length; i++) {
      if (bloc[i] === '{') n++;
      else if (bloc[i] === '}') { n--; if (n === 0) { fin = i; break; } }
    }
    /* On découpe le premier niveau du `return { … }` sur les virgules, puis on prend
       l'identifiant de tête de chaque tranche. Il FAUT accepter la forme abrégée
       (`{ taux, offres }`) : la première version ne cherchait que « nom : » et
       déclarait perdue une clé que le correctif rendait toujours, simplement en
       abrégé. Un garde qui invente des régressions se fait désactiver, et il a
       raison de l'être. */
    let p = 0, debut = 1;
    const tranches = [];
    for (let i = 1; i <= fin; i++) {
      const c = bloc[i];
      if (c === '{' || c === '(' || c === '[') p++;
      else if (c === '}' || c === ')' || c === ']') { if (p === 0 || i === fin) { tranches.push(bloc.slice(debut, i)); break; } p--; }
      else if (c === ',' && p === 0) { tranches.push(bloc.slice(debut, i)); debut = i + 1; }
    }
    for (const t of tranches) {
      const m = t.replace(/\/\/.*$/gm, '').trim().match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?::|,|$)/);
      if (m) noms.add(m[1]);
    }
  }
  return noms;
}

function surfacePerdue(chantier, base, bailFichiers) {
  const perdues = [];
  const dansLeBail = (f) => bailFichiers.some((b) => b === f || (b.endsWith('/') && f.startsWith(b)));
  for (const f of bailFichiers) {
    const avant = gitBrut(['show', `${base}:${f}`], chantier);
    if (!avant) continue;
    let apres; try { apres = fs.readFileSync(path.join(chantier, f), 'utf8'); } catch { continue; }
    const surfAvant = surfaceDe(avant), surfApres = surfaceDe(apres);
    for (const nom of surfAvant) {
      if (surfApres.has(nom) || nom.length < 4) continue;
      /* Un nom disparu ne gêne que si quelqu'un HORS du bail s'en sert encore. */
      const utilisateurs = (gitBrut(['grep', '-l', '-e', `\\.${nom}\\b`, '--', ':!.backend'], chantier) || '')
        .split('\n').filter(Boolean).filter((u) => !dansLeBail(u));
      if (utilisateurs.length) perdues.push({ nom, fichier: f, utilisateurs: utilisateurs.slice(0, 4) });
    }
  }
  return perdues;
}

/* ══ 5 · LE RECOMPTE PAR EMPREINTES ══════════════════════════════════════════
   Il ne décide de rien — l'ouvrier peut faire taire le scanner — mais il dit deux
   choses que l'invariant ne dit pas : l'empreinte visée a-t-elle disparu du bilan,
   et une empreinte NOUVELLE est-elle apparue (une correction qui casse autre chose).
   ⚠️ Les empreintes d'« avant » se calculent SUR l'état d'avant. Les recalculer en
   lisant l'arbre déjà corrigé produit de fausses régressions. */

function rescanner(repo) {
  try {
    execFileSync('node', [path.join(SKILL, 'scripts', 'scan.mjs'), repo],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* code 1 = des défauts trouvés, c'est le cas normal */ }
  return fileDeReparation(repo);
}

/* ══ 6 · LES COMMANDES ═══════════════════════════════════════════════════════ */

const lirePlan = () => {
  if (!fs.existsSync(PLAN)) { console.error(`Pas de plan. Lancer : node boucle.mjs ${RACINE} preparer`); process.exit(2); }
  return JSON.parse(fs.readFileSync(PLAN, 'utf8'));
};
const ecrirePlan = (p) => fs.writeFileSync(PLAN, JSON.stringify(p, null, 2) + '\n');

function preparer() {
  const file = fileDeReparation(RACINE);
  const contrats = file.defauts.map((d) => {
    const c = contratDe(RACINE, d);
    return { ...c, jumeauxFichiers: jumeauxFichiers(d), niveau: d.niveau, gravite: d.gravite };
  });
  const lots = decouper(contrats);
  const fondation = fondationAuth(RACINE);

  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(path.join(DOSSIER, 'empreintes-bilan.json'), JSON.stringify(file, null, 2) + '\n');
  ecrirePlan({
    date: file.date, base: gitMuet(['rev-parse', 'HEAD']), racine: RACINE,
    entree: { source: file.source, bilan: file.bilan, compte: file.compte, concorde: file.concorde },
    fondationAuth: fondation,
    empreintesAvant: file.defauts.map((d) => d.id),
    lots,
  });

  console.log(`\n╔══ CHANTIER ─ ${path.basename(RACINE)}`);
  console.log(`║  entrée : .backend/${file.source} + BILAN.md`);
  console.log(`║  ${file.defauts.length} défauts · trompe ${file.compte.trompe} · cassé ${file.compte['cassé']} · dette ${file.compte.dette}` +
    `  ${file.concorde === null ? '(pas de BILAN.md)' : file.concorde ? '(concorde avec BILAN.md)' : '⚠️ DIVERGE DE BILAN.md'}`);
  console.log(`║  ${lots.length} lots à périmètres disjoints · ${contrats.filter((c) => !c.injugeable).length} défauts jugeables, ${contrats.filter((c) => c.injugeable).length} injugeables`);
  console.log(`║  fondation d'authentification : ${fondation.existe ? `OUI (${fondation.config || fondation.gardes.join(', ')})` : 'NON → jamais de garde d’identité, bascule en interne'}`);
  console.log(`╚══ plan : .backend/lots.json\n`);
  return lots;
}

function afficherLots() {
  const { lots } = lirePlan();
  console.log(`\n${lots.length} lots, dans l'ordre du baromètre :\n`);
  for (const [i, l] of lots.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${l.niveau.padEnd(7)} ${l.fichier}   (${l.jugeables} jugeable(s), ${l.injugeables} injugeable(s))   état : ${l.etat}`);
    console.log(`      bail : ${l.bail.fichiers.join(', ')}`);
    for (const c of l.contrats) console.log(`      ${c.injugeable ? '✗' : '·'} ${c.id}  ${c.constat.slice(0, 84)}`);
  }
  console.log();
}

function trouverLot(plan, nom) {
  const l = plan.lots.find((x) => x.nom === nom || x.fichier === nom);
  if (!l) { console.error(`Lot inconnu : ${nom}`); process.exit(2); }
  return l;
}

function ouvrir(plan, lot) {
  fs.mkdirSync(CHANTIERS, { recursive: true });
  const chantier = path.join(CHANTIERS, lot.nom);
  if (fs.existsSync(chantier)) gitMuet(['worktree', 'remove', '--force', chantier]);
  git(['worktree', 'add', '--detach', chantier, plan.base || 'HEAD']);

  const jugeables = lot.contrats.filter((c) => !c.injugeable);
  const bail = { ...lot.bail, ouvertLe: new Date().toISOString(), base: plan.base || 'HEAD' };
  const contrat = {
    lot: lot.nom, bail: lot.bail.fichiers, defauts: jugeables,
    invariants: jugeables.flatMap((c) => c.invariants),
    ecartes: lot.contrats.filter((c) => c.injugeable).map((c) => ({ id: c.id, constat: c.constat, raison: c.injugeable })),
  };
  const atelier = ATELIER(chantier);
  fs.mkdirSync(atelier, { recursive: true });
  fs.writeFileSync(path.join(atelier, 'bail.json'), JSON.stringify(bail, null, 2) + '\n');
  fs.writeFileSync(path.join(atelier, 'contrat.json'), JSON.stringify(contrat, null, 2) + '\n');
  fs.writeFileSync(path.join(atelier, 'BRIEF.md'), briefOuvrier(lot, jugeables, lot.motifs.join('\n')) + '\n');
  lot.etat = 'ouvert';
  return { chantier, contrat };
}

function corriger(lot, chantier) {
  const invite = fs.readFileSync(path.join(ATELIER(chantier), 'BRIEF.md'), 'utf8');
  const r = lancerAgent({
    invite, cwd: chantier, outils: 'Read,Edit,Write,Grep,Glob', budget: 5, etiquette: `ouvrier ${lot.nom}`,
  });
  fs.writeFileSync(path.join(ATELIER(chantier), 'ouvrier.json'), JSON.stringify(r, null, 2) + '\n');
  return r;
}

/* ── LE JUGE ────────────────────────────────────────────────────────────────
   Dans l'ordre, et l'ordre est la doctrine : le bail d'abord (un lot hors bail est
   révoqué avant toute mesure), le linter anti-triche, le typage, les invariants,
   et seulement ensuite un agent en contexte frais pour ce qui relève de l'intention.
   Le recompte est mesuré et affiché ; il n'accepte jamais seul. */

const SCHEMA_JUGE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ACCEPTÉ', 'REFUSÉ'] },
    motif: { type: 'string' },
  },
  required: ['verdict', 'motif'],
};

function juger(plan, lot, chantier) {
  const contrat = JSON.parse(fs.readFileSync(path.join(ATELIER(chantier), 'contrat.json'), 'utf8'));
  const bailF = path.join(ATELIER(chantier), 'bail.json');

  /* 1. Le bail et les triches. */
  let g = {};
  try {
    g = JSON.parse(execFileSync('node', [path.join(ICI, 'diff-garde.mjs'), chantier, '--bail', bailF, '--base', plan.base || 'HEAD', '--json'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) { try { g = JSON.parse(e.stdout || '{}'); } catch { g = { violations: [{ regle: 'garde-en-panne', texte: String(e.message).slice(0, 120) }] }; } }
  const horsBail = (g.violations || []).filter((v) => v.regle === 'hors-bail');
  const triches = (g.violations || []).filter((v) => v.regle !== 'hors-bail');
  const diff = gitBrut(['diff', plan.base || 'HEAD', '--', ...lot.bail.fichiers], chantier);
  const fichiersTouches = g.fichiers || [];

  /* Un lot qui n'a rien changé n'est pas une correction : c'est un abandon, et il
     doit se lire comme tel plutôt que de passer pour un succès silencieux. */
  const rienFait = diff.trim() === '';

  /* 2. Le typage, en différentiel. */
  const typage = (horsBail.length || triches.length || rienFait) ? { ok: null, mesure: 'non mesuré (lot déjà refusé)', nouvelles: [] } : typageDifferentiel(chantier);

  /* 2 bis. La surface publique du bail : ce qu'il exportait doit exister encore,
     ou bien tous ceux qui s'en servent doivent être dans le bail. */
  const perdues = (horsBail.length || triches.length || rienFait) ? []
    : surfacePerdue(chantier, plan.base || 'HEAD', lot.bail.fichiers);

  /* 3. Les invariants, qui ne demandent rien au scanner. */
  const inv = contrat.invariants?.length ? verifierTous(chantier, contrat.invariants) : { ok: false, resultats: [] };

  /* 4. Le recompte par empreintes. Il n'ACCEPTE jamais — l'ouvrier peut faire taire
        le scanner — mais il REFUSE : « résolu » veut dire que l'empreinte visée a
        disparu ET qu'aucune nouvelle n'est apparue, toutes règles confondues. Une
        apparition est une correction qui a cassé autre chose, et c'est arrivé : un
        lot accepté par les invariants ET par le juge introduisait un nouveau total
        de devises non converties trois lignes plus bas. Chaque étape peut refuser
        seule ; aucune ne peut accepter seule. */
  let recompte = { mesure: 'non mesuré' };
  if (!horsBail.length && !triches.length && !rienFait) {
    try {
      const apres = rescanner(chantier);
      const avant = new Set(plan.empreintesAvant);
      const ids = new Set(apres.defauts.map((d) => d.id));
      const vises = contrat.defauts.map((c) => c.id);
      recompte = {
        avant: plan.empreintesAvant.length,
        apres: ids.size,
        visesDisparus: vises.filter((id) => !ids.has(id)),
        visesRestants: vises.filter((id) => ids.has(id)),
        apparues: [...ids].filter((id) => !avant.has(id)),
      };
      recompte.mesure = `${recompte.avant} → ${recompte.apres} empreintes · ${recompte.visesDisparus.length}/${vises.length} visées disparues · ${recompte.apparues.length} apparue(s)`;
    } catch (e) { recompte = { mesure: `recompte impossible : ${String(e.message).slice(0, 120)}` }; }
  }

  const regressions = recompte.apparues || [];

  /* 5. Le juge en contexte frais : le contrat, le diff, les invariants. Rien d'autre.
        Il ne voit ni le raisonnement de l'ouvrier, ni le recompte du scanner. */
  let juge = { verdict: null, motif: 'non consulté' };
  const mecaniqueOk = !horsBail.length && !triches.length && !rienFait && typage.ok !== false && inv.ok && !regressions.length && !perdues.length;
  if (mecaniqueOk && contrat.defauts.length) {
    const invite = [
      `Tu es le JUGE d'un lot de réparation. Tu n'as PAS écrit ce code et tu ne le corrigeras pas.`,
      `Tu reçois trois choses : le contrat, le diff, le résultat des invariants. Tu n'as ni le`,
      `raisonnement de l'ouvrier ni le recompte du scanner, exprès : l'un te transmettrait sa`,
      `conviction, l'autre peut être éteint par celui qu'il mesure.\n`,
      `Ta seule question : LE DIFF FAIT-IL CE QUE LE CONTRAT DEMANDE, sur le fond ?`,
      `Les invariants ont déjà prouvé la forme. Toi, tu cherches la correction qui satisfait la`,
      `lettre et rate l'intention : un champ écrit mais avec la mauvaise valeur, une garde posée`,
      `sur la mauvaise fonction, une conversion de devise inventée avec un taux en dur, un calcul`,
      `rendu « cohérent » en cassant l'autre côté, une donnée de démonstration remplacée par une`,
      `autre donnée de démonstration.\n`,
      `REFUSÉ si tu vois l'un de ces mouvements. ACCEPTÉ si le diff corrige réellement la cause.`,
      `Dans le doute sur un point de détail qui ne change pas ce que voit l'utilisateur : ACCEPTÉ.`,
      `\n═══ CONTRAT ═══`,
      ...contrat.defauts.map((c) => `\n[${c.niveau}] ${c.id}\n  CONSTAT ${c.constat}\n  ATTENDU ${c.attendu}`),
      `\n═══ INVARIANTS REJOUÉS (tous tenus, sinon tu ne serais pas consulté) ═══`,
      ...inv.resultats.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.nom} — ${r.mesure}`),
      `\n═══ DIFF ═══\n${diff.slice(0, 60000)}`,
      `\nRends { "verdict": "ACCEPTÉ" | "REFUSÉ", "motif": "une phrase, précise" }.`,
    ].join('\n');
    const r = lancerAgent({ invite, cwd: chantier, outils: '', schema: SCHEMA_JUGE, budget: 3, etiquette: `juge ${lot.nom}` });
    if (r.sec) juge = { verdict: 'ACCEPTÉ', motif: '(--sec : juge non consulté)' };
    else if (r.erreur) juge = { verdict: null, motif: r.erreur };
    else { try { juge = JSON.parse(r.texte); } catch { juge = { verdict: null, motif: `sortie du juge illisible : ${String(r.texte).slice(0, 160)}` }; } }
    juge.cout = r.cout;
  }

  const verdict = {
    lot: lot.nom, quand: new Date().toISOString(),
    fichiersTouches, horsBail, triches, rienFait, regressions, perdues,
    typage, invariants: inv.resultats, invariantsOk: inv.ok, recompte,
    juge,
    verdict:
      horsBail.length ? 'REFUSÉ'
        : triches.length ? 'REFUSÉ'
          : rienFait ? 'REFUSÉ'
            : !contrat.invariants?.length ? 'INJUGEABLE'
              : perdues.length ? 'REFUSÉ'
                : typage.ok === false ? 'REFUSÉ'
                  : !inv.ok ? 'REFUSÉ'
                    : regressions.length ? 'REFUSÉ'
                      : juge.verdict === 'REFUSÉ' ? 'REFUSÉ'
                        : juge.verdict === 'ACCEPTÉ' ? 'ACCEPTÉ'
                          : 'INJUGEABLE',
  };
  verdict.motif =
    horsBail.length ? `${horsBail.length} fichier(s) hors bail (${horsBail.map((v) => v.fichier).join(', ')}) : le lot ENTIER est révoqué`
      : triches.length ? `triche refusée par le linter : ${triches.map((t) => `[${t.regle}] ${t.texte}`).slice(0, 3).join(' · ')}`
        : rienFait ? `aucun fichier du bail n'a été modifié : rien à juger`
          : perdues.length ? `le lot retire de son bail ${perdues.length} nom(s) que des fichiers HORS bail lisent encore : ${perdues.map((x) => `« ${x.nom} » (lu par ${x.utilisateurs.join(', ')})`).join(' · ')}. Le bail protège des collisions, il n'autorise pas à casser le voisin.`
            : typage.ok === false ? `${typage.nouvelles.length} erreur(s) de typage NOUVELLE(s) : ${typage.nouvelles.slice(0, 2).join(' · ')}`
            : !inv.ok ? `invariant non tenu : ${inv.resultats.filter((r) => !r.ok).map((r) => `${r.nom} (${r.mesure})`).join(' · ')}`
              : regressions.length ? `${regressions.length} empreinte(s) NOUVELLE(s) au recompte (${regressions.join(', ')}) : la correction a cassé autre chose`
                : juge.motif || 'sans motif';

  fs.writeFileSync(path.join(ATELIER(chantier), 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
  return verdict;
}

function fusionner(plan, lot, chantier) {
  /* On livre un DIFF, on n'applique jamais d'autorité sur le projet du client. Sur
     la copie de travail, la fusion est un `git apply` du patch du lot : le patch est
     l'objet livrable, l'application n'en est qu'une preuve. */
  const patch = gitBrut(['diff', plan.base || 'HEAD', '--', ...lot.bail.fichiers], chantier);
  const fichierPatch = path.join(DOSSIER, `reparation-${lot.nom}.patch`);
  fs.writeFileSync(fichierPatch, patch);
  const lignes = patch.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
  /* Une fusion qui casse ne doit pas emporter la boucle : le patch est écrit, c'est
     lui le livrable, et le lot est marqué « à appliquer à la main » plutôt que de
     faire tomber les huit lots suivants. */
  try {
    execFileSync('git', ['-C', RACINE, 'apply', '--whitespace=nowarn', fichierPatch], { encoding: 'utf8' });
    git(['add', '-A', '--', ...lot.bail.fichiers]);
    git(['-c', 'user.email=boucle@local', '-c', 'user.name=boucle', 'commit', '-qm', `réparation ${lot.nom}`]);
  } catch (e) {
    return { patch: path.relative(RACINE, fichierPatch), lignes, applique: false, erreur: String(e.message).split('\n')[0].slice(0, 160) };
  }
  return { patch: path.relative(RACINE, fichierPatch), lignes, applique: true };
}

const fermer = (nom) => { gitMuet(['worktree', 'remove', '--force', path.join(CHANTIERS, nom)]); gitMuet(['worktree', 'prune']); };

/* ══ 7 · TOURNER : toute la chaîne, sans main humaine ════════════════════════ */

function tourner() {
  const t0 = Date.now();
  preparer();
  const plan = lirePlan();
  /* Le socle de typage se relève AVANT la première fusion : mesuré plus tard, il
     inclurait déjà les corrections fusionnées et le différentiel comparerait un lot
     à un état qui n'est plus le sien. */
  if (fs.existsSync(path.join(RACINE, 'tsconfig.json')) && !SEC) {
    SIGS_BASE = signaturesTsc(RACINE);
    console.log(SIGS_BASE.arun
      ? `  socle de typage : ${SIGS_BASE.sigs.size} signature(s) d'erreur avant toute correction\n`
      : `  ⚠️  typage non mesurable : ${SIGS_BASE.raison}\n`);
  }
  const maxLots = Number(OPT('lots', plan.lots.length));
  const journal = [];
  let cout = 0;

  for (const lot of plan.lots.slice(0, maxLots)) {
    if (!lot.jugeables) {
      lot.etat = 'écarté';
      journal.push({ lot: lot.nom, verdict: 'INJUGEABLE', motif: lot.contrats.map((c) => c.injugeable).join(' · '), essai: 0 });
      console.log(`\n▸ ${lot.nom} — écarté : aucun défaut jugeable`);
      continue;
    }
    for (let essai = 1; essai <= ESSAIS; essai++) {
      lot.essais = essai;
      console.log(`\n▸ LOT ${lot.nom}  (${lot.niveau}, ${lot.jugeables} défaut(s), tentative ${essai}/${ESSAIS})`);
      const { chantier } = ouvrir(plan, lot);
      console.log(`  bail : ${lot.bail.fichiers.join(', ')}`);

      const ouvrier = corriger(lot, chantier);
      cout += ouvrier.cout || 0;
      if (ouvrier.erreur) console.log(`  ⚠️  ouvrier : ${ouvrier.erreur}`);
      else console.log(`  ouvrier : ${(ouvrier.ms / 1000).toFixed(0)} s, ${(ouvrier.cout || 0).toFixed(2)} $ — ${String(ouvrier.texte).split('\n')[0].slice(0, 100)}`);

      const v = juger(plan, lot, chantier);
      cout += v.juge?.cout || 0;
      console.log(`  garde : ${v.fichiersTouches.length} fichier(s), ${v.horsBail.length} hors bail, ${v.triches.length} triche(s)`);
      console.log(`  typage : ${v.typage.mesure}`);
      for (const r of v.invariants) console.log(`  ${r.ok ? '✓' : '✗'} ${String(r.nom).padEnd(44)} ${r.mesure}`);
      console.log(`  recompte : ${v.recompte.mesure}`);
      console.log(`  ══ ${v.verdict} — ${v.motif}`);

      journal.push({
        lot: lot.nom, essai, verdict: v.verdict, motif: v.motif,
        fichiers: v.fichiersTouches, invariants: v.invariants.map((r) => ({ nom: r.nom, ok: r.ok, mesure: r.mesure })),
        recompte: v.recompte, typage: v.typage.mesure, juge: v.juge?.motif ?? null,
        defauts: lot.contrats.filter((c) => !c.injugeable).map((c) => c.id),
      });

      if (v.verdict === 'ACCEPTÉ') {
        const f = fusionner(plan, lot, chantier);
        lot.etat = f.applique ? 'fusionné' : 'patch non appliqué';
        lot.patch = f.patch;
        console.log(f.applique
          ? `  fusionné : ${f.patch} (${f.lignes} lignes)`
          : `  ⚠️  patch écrit mais NON appliqué (${f.erreur}) : ${f.patch}`);
        journal[journal.length - 1].fusion = f;
        fermer(lot.nom);
        break;
      }
      /* Refusé : le worktree est détruit, le défaut repart en file AVEC son motif.
         C'est ce motif qui rend la seconde tentative meilleure — une relance à
         l'identique redonne la même correction. */
      lot.motifs.push(`Tentative ${essai} refusée. Motif du juge : ${v.motif}`);
      lot.etat = essai === ESSAIS ? 'refusé' : 'à reprendre';
      fermer(lot.nom);
    }
    ecrirePlan(plan);
  }

  /* Le recompte final, sur la copie fusionnée. */
  const apres = rescanner(RACINE);
  const avant = new Set(plan.empreintesAvant);
  const ids = new Set(apres.defauts.map((d) => d.id));
  const bilan = {
    date: new Date().toISOString(),
    entree: plan.entree,
    lots: plan.lots.length,
    journal,
    coutUSD: Number(cout.toFixed(2)),
    minutes: Number(((Date.now() - t0) / 60000).toFixed(1)),
    empreintes: {
      avant: plan.empreintesAvant.length,
      apres: ids.size,
      disparues: plan.empreintesAvant.filter((id) => !ids.has(id)),
      apparues: [...ids].filter((id) => !avant.has(id)),
    },
  };
  fs.writeFileSync(path.join(DOSSIER, 'boucle-bilan.json'), JSON.stringify(bilan, null, 2) + '\n');
  ecrirePlan(plan);
  /* Le bilan est réécrit sur l'état d'APRÈS. Laisser BILAN.md décrire le projet
     d'avant pendant que le code a changé est la façon la plus sûre de faire croire
     que rien n'a bougé — ou que tout a été réparé. */
  try { execFileSync('node', [path.join(SKILL, 'scripts', 'bilan.mjs'), RACINE], { stdio: ['ignore', 'ignore', 'ignore'] }); } catch { /* code 1/2 = normal */ }

  const acc = journal.filter((j) => j.verdict === 'ACCEPTÉ');
  console.log(`\n╔══ BOUCLE TERMINÉE ─ ${bilan.minutes} min · ${bilan.coutUSD} $`);
  console.log(`║  ${plan.empreintesAvant.length} défauts en entrée · ${plan.lots.length} lots`);
  console.log(`║  ${acc.length} lot(s) accepté(s) · ${journal.filter((j) => j.verdict === 'REFUSÉ').length} refusé(s) · ${journal.filter((j) => j.verdict === 'INJUGEABLE').length} injugeable(s)`);
  console.log(`║  empreintes : ${bilan.empreintes.avant} → ${bilan.empreintes.apres}  (−${bilan.empreintes.disparues.length} disparues, +${bilan.empreintes.apparues.length} apparues)`);
  console.log(`╚══ .backend/boucle-bilan.json\n`);
  process.exitCode = acc.length ? 0 : 1;
}

/* ══ Aiguillage ══════════════════════════════════════════════════════════════ */

if (!fs.existsSync(RACINE)) { console.error(`Dépôt introuvable : ${RACINE}`); process.exit(2); }
if (!gitMuet(['rev-parse', '--git-dir'])) { console.error(`${RACINE} n'est pas un dépôt git : la boucle ne peut pas imposer de bail.`); process.exit(2); }

if (CMD === 'preparer') preparer();
else if (CMD === 'lots') afficherLots();
else if (CMD === 'tourner') tourner();
else if (CMD === 'ouvrir') {
  const plan = lirePlan(); const lot = trouverLot(plan, NOM_LOT);
  const { chantier } = ouvrir(plan, lot); ecrirePlan(plan);
  console.log(`\n╔══ LOT OUVERT ─ ${lot.nom}\n║  chantier : ${chantier}\n║  bail : ${lot.bail.fichiers.join(', ')}\n╚══ brief : ${path.join(ATELIER(chantier), 'BRIEF.md')}\n`);
}
else if (CMD === 'corriger') {
  const plan = lirePlan(); const lot = trouverLot(plan, NOM_LOT);
  const r = corriger(lot, path.join(CHANTIERS, lot.nom));
  console.log(r.erreur ? `⚠️  ${r.erreur}` : `ouvrier : ${(r.ms / 1000).toFixed(0)} s, ${(r.cout || 0).toFixed(2)} $\n${r.texte}`);
}
else if (CMD === 'juger') {
  const plan = lirePlan(); const lot = trouverLot(plan, NOM_LOT);
  const v = juger(plan, lot, path.join(CHANTIERS, lot.nom));
  console.log(`\n╔══ VERDICT ─ ${lot.nom} : ${v.verdict}\n║  ${v.motif}\n╚══ ${v.fichiersTouches.length} fichier(s) touché(s)\n`);
  for (const r of v.invariants) console.log(`  ${r.ok ? '✓' : '✗'} ${String(r.nom).padEnd(44)} ${r.mesure}`);
  console.log(`  recompte : ${v.recompte.mesure}\n`);
  process.exitCode = v.verdict === 'ACCEPTÉ' ? 0 : 1;
}
else if (CMD === 'fermer') { fermer(NOM_LOT); console.log(`chantier ${NOM_LOT} fermé.`); }
else { console.error(`Commande inconnue : ${CMD}`); process.exit(2); }

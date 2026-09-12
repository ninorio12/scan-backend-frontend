#!/usr/bin/env node
/**
 * accord.mjs : est-ce que ce que je viens d'écrire est d'accord avec le reste ?
 *
 *     node accord.mjs <repo>                      les fichiers modifiés, pas encore commités
 *     node accord.mjs <repo> --module app/agenda  un dossier précis
 *     node accord.mjs <repo> --depuis HEAD~3      tout ce qui a changé depuis là
 *     node accord.mjs <repo> --json f             le détail en JSON
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le reste de ce skill répond à une question que le métier a abandonnée depuis
 * longtemps : « trouve tous les bugs de ce SaaS ». Mesuré sur 140 vrais défauts tirés
 * de notre historique git, il diagnostique 9,3 % des cas et émet 983 signalements par
 * défaut réel. Il ne se trompe pas tant que ça : il NOIE.
 *
 * Ici on pose l'autre question, celle qui a une réponse : « ce que je viens d'écrire
 * est-il d'accord avec ce qui existait ? ». Dix fichiers au lieu de quatre cents, une
 * intention connue (celle de la demi-heure qui vient de passer), et le moment où
 * réparer coûte deux minutes au lieu de trois semaines.
 *
 * LES TROIS LOIS, ET ELLES SONT DURES
 *
 *   1. UN SIGNALEMENT NOMME SES DEUX CÔTÉS. Pas « il y a un problème ici » mais
 *      « ici on lit A, ailleurs on lit B ». Sans les deux côtés et sans la phrase du
 *      désaccord, le signalement n'existe pas. Conséquence recherchée : quand on répare
 *      un côté, les deux s'accordent et le signalement disparaît TOUT SEUL. Aujourd'hui
 *      il survit à la réparation trois fois sur quatre.
 *   2. CINQ AU MAXIMUM. Google retire un analyseur au-dessus de 10 % de fausses
 *      alertes et tourne sous 5 % ; la règle d'astreinte est de deux alertes
 *      actionnables par garde. Un outil qui en sort cinquante est déjà mort, quelle
 *      que soit sa justesse. S'il y en a plus, on dit combien et on montre les cinq
 *      plus graves.
 *   3. SILENCE QUAND TOUT VA BIEN. Une ligne, pas un rapport. Un outil qui parle
 *      quand il n'a rien à dire apprend à être ignoré.
 *
 * CE QU'IL COMPARE : uniquement les concepts que le module touche, et toujours par
 * rapport au RESTE de l'application. Un désaccord qui existait déjà partout ailleurs
 * n'est pas le fait de ce module : ce n'est pas sa faute, et ce n'est pas le moment.
 *
 * CODES DE SORTIE : 0 d'accord · 1 des désaccords · 2 le travail n'a pas pu être fait.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extraire } from './extraire.mjs';
import { cleNorm } from './lexique.mjs';
import { ecrireJson } from './dossier-backend.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const a = (n) => process.argv.includes(n);

const PREMIER = process.argv[2];
if (a('--help') || a('-h') || !PREMIER || PREMIER.startsWith('-')) {
  console.log(`
  accord.mjs : ce que je viens d'écrire est-il d'accord avec le reste ?

      node scripts/accord.mjs <dépôt>                      les fichiers non commités
      node scripts/accord.mjs <dépôt> --module app/agenda  un dossier précis
      node scripts/accord.mjs <dépôt> --depuis HEAD~3      ce qui a changé depuis là
      node scripts/accord.mjs <dépôt> --json <fichier>     le détail

  Sort 5 désaccords au maximum, chacun avec ses deux côtés. Silence si tout va bien.
  Codes : 0 d'accord · 1 des désaccords · 2 travail impossible.
`);
  process.exit(a('--help') || a('-h') ? 0 : 2);
}

const RACINE = path.resolve(PREMIER);
if (!fs.existsSync(RACINE) || !fs.statSync(RACINE).isDirectory()) {
  console.error(`  ⛔ ${RACINE} n'est pas un dossier.`); process.exit(2);
}

const PLAFOND = 5;

/* ── 1. QUEL EST LE MODULE ? ───────────────────────────────────────────────────
   Trois façons de le désigner, et aucune n'est devinée : on refuse plutôt que de
   choisir à la place de la personne. Un contrôle lancé sur le mauvais périmètre
   rend un rapport sur le travail de quelqu'un d'autre. */

const git = (args) => {
  try {
    return execFileSync('git', ['-C', RACINE, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
};

let fichiersModule = [];
let commentDesigne = '';

const dossier = arg('--module', null);
const depuis = arg('--depuis', null);

if (dossier) {
  const base = path.resolve(RACINE, dossier);
  if (!fs.existsSync(base)) { console.error(`  ⛔ ${dossier} n'existe pas dans ce dépôt.`); process.exit(2); }
  const marcher = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|\.next|\.git|dist|build)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marcher(p);
      else if (/\.[jt]sx?$/.test(e.name)) fichiersModule.push(path.relative(RACINE, p));
    }
  };
  if (fs.statSync(base).isDirectory()) marcher(base);
  else fichiersModule.push(path.relative(RACINE, base));
  commentDesigne = `le dossier ${dossier}`;
} else {
  const ref = depuis || null;
  const sortie = ref ? git(['diff', '--name-only', ref, '--']) : git(['status', '--porcelain']);
  if (sortie === null) {
    console.error(`  ⛔ ${RACINE} n'est pas un dépôt git, et aucun --module n'a été donné.`);
    console.error(`     Sans l'un des deux je ne sais pas ce que « je viens d'écrire » désigne.`);
    process.exit(2);
  }
  fichiersModule = sortie.split('\n').map((l) => (ref ? l.trim() : l.slice(3).trim()))
    .filter((f) => f && /\.[jt]sx?$/.test(f) && fs.existsSync(path.join(RACINE, f)));
  commentDesigne = ref ? `ce qui a changé depuis ${ref}` : 'les fichiers non commités';
}

if (!fichiersModule.length) {
  console.log(`\n  Rien à contrôler : ${commentDesigne} ne contient aucun fichier de code.\n`);
  process.exit(0);
}

/* Au-delà, ce n'est plus « le module que je viens d'écrire », c'est un audit. Et un
   audit, c'est l'autre outil, celui qui noie. On le dit au lieu de faire semblant. */
if (fichiersModule.length > 40) {
  console.error(`\n  ⛔ ${fichiersModule.length} fichiers : c'est un audit, pas un module.`);
  console.error(`     Cet outil répond à « ce que je viens d'écrire est-il d'accord avec le reste ».`);
  console.error(`     Au-delà de 40 fichiers il n'a plus de reste auquel comparer.`);
  console.error(`     Viser un dossier précis : --module <chemin>`);
  process.exit(2);
}

/* ── 2. LIRE TOUT LE DÉPÔT ─────────────────────────────────────────────────────
   Il faut bien tout lire : « d'accord avec le reste » suppose de connaître le reste.
   Ce qui change, c'est qu'on ne RAPPORTE que le module. */

let elements;
try { ({ elements } = extraire(RACINE)); }
catch (e) {
  console.error(`\n  ⛔ Lecture du code impossible : ${String(e.message).split('\n')[0]}`);
  console.error(`     (ce skill lit le code avec le TypeScript du projet : npm install dans le dépôt)`);
  process.exit(2);
}

const dansModule = new Set(fichiersModule.map((f) => f.replace(/\\/g, '/')));
const estDuModule = (e) => dansModule.has((e.fichier || '').replace(/\\/g, '/'));

/* Un concept trop général ne désigne rien : « date », « nom », « statut » existent
   partout et les regrouper fabrique du bruit à la chaîne. Même chose pour les verbes :
   « créer » ou « lister » vivent dans tous les modules, et c'est normal. */
const TROP_VAGUE = new Set(['date', 'statut', 'nom', 'actif', 'note', 'id', 'total', 'type', 'montant', 'valeur', 'texte']);
const VERBES = new Set(['creer', 'enregistrer', 'supprimer', 'modifier', 'lister', 'liste', 'obtenir',
  'chercher', 'compter', 'basculer', 'archiver', 'envoyer', 'ouvrir', 'fermer', 'ajouter', 'retirer',
  'marquer', 'valider', 'annuler', 'charger', 'maj', 'creation']);
/* Ce qui a le droit d'écrire n'importe où. Les tests en font partie, et le motif les
   ratait : il cherchait un DOSSIER `tests/` alors que le fichier s'appelle
   `convertToClient.test.ts`. Un test qui insère un faux lead sortait donc en défaut
   (mesuré le 12/09/2026 sur QOS, un faux positif sur cinq signalements tirés au sort). */
const ECRIT_PARTOUT = /(^|\/)(seed|seeds|fixtures?|migration|migrations|backfill|_generated|scripts|tests?|__tests__|e2e|banc)\b|\.(test|spec)\.[jt]sx?$/i;

const tables = elements.filter((e) => e.classe === 'table');
if (!tables.length) {
  console.error(`\n  ⛔ Aucune table de données reconnue dans ce dépôt.`);
  console.error(`     Sans savoir où vivent les données, « d'accord avec le reste » ne compare rien.`);
  process.exit(2);
}
const ENTITES = new Set();
for (const t of tables) for (const c of cleNorm(t.nom || '').split('|')) if (c && c.length >= 3) ENTITES.add(c);

const conceptsDe = (e) => cleNorm(e.nom || '').split('|')
  .filter((c) => c && c.length >= 3 && !TROP_VAGUE.has(c) && !VERBES.has(c) && ENTITES.has(c));

/* ── 3. PREMIER DÉSACCORD : CE MODULE LIT AILLEURS QUE LES AUTRES ──────────────
   Pour chaque concept, qui le lit et dans quelle table. On ne garde que les concepts
   que CE module lit, et seulement quand sa table diffère de celle du reste. */

/* ⚠️ CETTE RÈGLE EST ÉTEINTE PAR DÉFAUT, ET VOICI POURQUOI.
   Mesurée le 12/09/2026 sur QOS : quatre signalements vérifiés à la main, quatre faux.
   La cause n'est pas la règle, elle est en amont. L'extracteur attribue à chaque
   élément la table du contexte le plus proche (`e.entite`), pas celle qu'on lit
   vraiment. Trois exemples relevés :
     · convex/booking.ts:174 « lit booking_links » : la ligne fait ctx.db.get() sur
       crm_contacts, l'outil a pris la table de la fonction qui l'entoure.
     · convex/closing.ts:326 « lit closing » : la fonction déclare
       contactId: v.id("crm_contacts"), elle lit donc crm_contacts.
     · convex/closing.ts:743 « le concept dernier lit os_sales_calls » : c'est
       lastSyncAt dans un objet de retour, ce n'est pas une entité du tout.
   Tant qu'on ne sait pas dire QUELLE table une ligne lit, cette règle fabrique des
   paires fausses, et une paire fausse est pire qu'un silence : elle coûte au lecteur
   le temps d'aller vérifier, et elle lui apprend à ne plus nous lire.
   `--lectures` la rallume pour qui veut travailler dessus. Le jour où l'attribution
   sera fiable, on l'enlèvera de derrière ce drapeau, pas avant. */
const LECTURES_ACTIVES = a('--lectures');
const LECTURES = ['champ.projection', 'champ.affiche', 'fonction.serveur'];
const lecturesParConcept = new Map();   // concept → Map(table → [{fichier, ligne, interne}])

for (const e of LECTURES_ACTIVES ? elements : []) {
  if (!LECTURES.includes(e.classe) || !e.entite) continue;
  for (const c of conceptsDe(e)) {
    if (!lecturesParConcept.has(c)) lecturesParConcept.set(c, new Map());
    const m = lecturesParConcept.get(c);
    if (!m.has(e.entite)) m.set(e.entite, []);
    m.get(e.entite).push({ fichier: e.fichier, ligne: e.ligne, interne: estDuModule(e) });
  }
}

const desaccords = [];

for (const [concept, parTable] of lecturesParConcept) {
  if (parTable.size < 2) continue;                       // une seule source : tout le monde est d'accord
  const tablesDuModule = [...parTable].filter(([, ou]) => ou.some((x) => x.interne));
  if (!tablesDuModule.length) continue;                  // ce module ne lit pas ce concept : pas son affaire
  const tablesDuReste = [...parTable].filter(([, ou]) => ou.some((x) => !x.interne));
  if (!tablesDuReste.length) continue;                   // personne d'autre ne le lit : rien à comparer

  /* LA RÉFÉRENCE EST LA MAJORITÉ, pas l'absence. Pour un concept donné, la table que
     tout le reste lit fait foi. Le module est en désaccord s'il lit une autre table
     ET qu'il ne lit pas aussi celle-là : dans ce cas il affichera un autre chiffre que
     ses voisins pour la même chose. S'il lit les deux, il fait le lien, c'est son rôle.

     La première version exigeait que la table d'ici ne soit lue par personne d'autre.
     Trop dur : sur QOS, « contact » est lu depuis crm_contacts seize fois et depuis
     devis huit fois, et aucun des deux camps n'est seul, donc elle ne disait rien. */
  const [tableMajoritaire, ouMaj] = [...parTable].sort((x, y) => y[1].length - x[1].length)[0];
  const moduleLitLaMajoritaire = (parTable.get(tableMajoritaire) || []).some((x) => x.interne);
  if (moduleLitLaMajoritaire) continue;
  const laReference = ouMaj.find((x) => !x.interne);
  if (!laReference) continue;

  for (const [table, ou] of tablesDuModule) {
    if (table === tableMajoritaire) continue;
    const ici = ou.find((x) => x.interne);
    desaccords.push({
      gravite: 1,
      concept,
      phrase: `« ${concept} » : ce module lit une autre source que le reste de l'application.`,
      ici: { ou: `${ici.fichier}:${ici.ligne}`, quoi: `lit ${table}` },
      ailleurs: { ou: `${laReference.fichier}:${laReference.ligne}`, quoi: `lit ${tableMajoritaire}`, combien: ouMaj.length },
    });
  }
}

/* ── 4. SECOND DÉSACCORD : CE MODULE ÉCRIT CHEZ QUELQU'UN D'AUTRE ──────────────
   Une table a un propriétaire : le module qui porte son nom. Tout autre module qui y
   écrit passe derrière lui et peut défaire ce qu'il garantit. */

const ECRITURES = ['operation.ecriture', 'champ.ecrit', 'operation.suppression'];
const nomModule = (f) => {
  const sans = (f || '').replace(/\.[jt]sx?$/, '');
  const b = path.basename(sans);
  return /^(route|page|index|handler|actions|action)$/.test(b) ? (path.basename(path.dirname(sans)) || b) : b;
};

const ecrituresParTable = new Map();    // table → [{fichier, ligne, interne}]
for (const e of elements) {
  if (!ECRITURES.includes(e.classe) || !e.entite) continue;
  if (e.operation === 'default') continue;              // écrit par la base, pas par un module
  if (ECRIT_PARTOUT.test(e.fichier || '')) continue;
  if (!ecrituresParTable.has(e.entite)) ecrituresParTable.set(e.entite, []);
  ecrituresParTable.get(e.entite).push({ fichier: e.fichier, ligne: e.ligne, interne: estDuModule(e) });
}

for (const [table, ou] of ecrituresParTable) {
  const ici = ou.find((x) => x.interne);
  if (!ici) continue;                                    // ce module n'écrit pas là : pas son affaire
  const cle = cleNorm(table).split('|')[0];
  const proprio = ou.find((x) => !x.interne && cleNorm(nomModule(x.fichier)).split('|').includes(cle));
  if (!proprio) continue;                                // pas de propriétaire identifié : on se tait
  if (cleNorm(nomModule(ici.fichier)).split('|').includes(cle)) continue;   // c'est lui, le propriétaire
  desaccords.push({
    gravite: 2,
    concept: table,
    phrase: `« ${table} » : ce module écrit dans une table qu'il ne possède pas.`,
    ici: { ou: `${ici.fichier}:${ici.ligne}`, quoi: `écrit ${table}` },
    ailleurs: { ou: `${proprio.fichier}:${proprio.ligne}`, quoi: `propriétaire : ${nomModule(proprio.fichier)}`, combien: 1 },
  });
}

/* ── 5. LE RAPPORT, CINQ LIGNES AU PLUS ────────────────────────────────────────
   Les plus graves d'abord : écrire chez quelqu'un d'autre casse une garantie, lire
   ailleurs affiche un chiffre faux. Les deux comptent, l'écriture d'abord. */

desaccords.sort((x, y) => (y.gravite - x.gravite) || (y.ailleurs.combien - x.ailleurs.combien));
const montres = desaccords.slice(0, PLAFOND);

const nom = path.basename(RACINE);
if (!desaccords.length) {
  console.log(`\n  ✓ ${fichiersModule.length} fichiers contrôlés (${commentDesigne}) : d'accord avec le reste.\n`);
} else {
  console.log(`\n  ACCORD DU MODULE — ${nom} · ${fichiersModule.length} fichiers (${commentDesigne})`);
  console.log(`  ${'-'.repeat(72)}`);
  console.log(`  ${desaccords.length} désaccord${desaccords.length > 1 ? 's' : ''} avec le reste de l'application.` +
    (desaccords.length > PLAFOND ? `  Les ${PLAFOND} plus graves :` : ''));
  console.log();
  montres.forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.phrase}`);
    console.log(`       ici        ${d.ici.ou.padEnd(44)} ${d.ici.quoi}`);
    console.log(`       ailleurs   ${d.ailleurs.ou.padEnd(44)} ${d.ailleurs.quoi}` +
      (d.ailleurs.combien > 1 ? `  (${d.ailleurs.combien} endroits)` : ''));
    console.log();
  });
}

const J = arg('--json', null);
if (J) {
  const f = ecrireJson(RACINE, 'accord.json', {
    racine: RACINE, perimetre: commentDesigne, fichiers: fichiersModule,
    total: desaccords.length, desaccords,
  }, J);
  console.log(`  Détail : ${f}\n`);
}

process.exitCode = desaccords.length ? 1 : 0;

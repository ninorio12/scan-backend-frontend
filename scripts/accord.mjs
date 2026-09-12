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
   sera fiable, on l'enlèvera de derrière ce drapeau, pas avant.

   ⚠️ ET LA RÉPARATION DE L'ATTRIBUTION NE SUFFIT PAS : ESSAYÉE, MESURÉE, ANNULÉE.
   Le 12/09/2026, `extraire.mjs` a reçu un champ `entiteSure` qui ne vaut que ce que la
   source dit en toutes lettres (variable déclarée par un `query("t")`, un cast `Id<"t">`
   ou un argument `v.id("t")`) et qui est nul partout ailleurs, et cette règle a été
   rebranchée dessus. Ça marche : les trois faux cités plus haut disparaissent, et
   `convex/closing.ts` passe de cinq signalements à zéro. Ça ne rend rien pour autant :
   avec `--lectures`, le bruit monte de 22 à 43 (au-dessus du plafond de 40) et le corpus
   reste à zéro. La raison n'est plus l'attribution, elle est le CONCEPT : `conceptsDe`
   découpe les noms en mots, si bien que « membre » apparie `socialConnections` et
   `collaborators`, et « video » apparie `brandOsVideos` et `youtubeChannelLinks`. Les
   deux côtés sont désormais vrais et la paire reste absurde. Tant que deux tables se
   rencontrent sur un mot commun au lieu de se rencontrer sur une même donnée, cette
   règle ne peut pas sortir de derrière son drapeau. C'est là qu'il faut frapper, pas sur
   l'extracteur. */
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

/* `operation.suppression` a été RETIRÉE de cette liste. L'adaptateur résout la table
   d'un insert par son littéral (exact) et s'abstient proprement sur un patch qu'il ne
   sait pas localiser, mais il attribue encore un delete par repli sur la table de la
   fonction englobante. C'est exactement la maladie qui a tué la règle des lectures, et
   elle vivait encore ici sur un tiers des entrées. On ne garde que ce qui est établi. */
const ECRITURES = ['operation.ecriture', 'champ.ecrit'];
const nomModule = (f) => {
  const sans = (f || '').replace(/\.[jt]sx?$/, '');
  const b = path.basename(sans);
  return /^(route|page|index|handler|actions|action)$/.test(b) ? (path.basename(path.dirname(sans)) || b) : b;
};

/* QUI POSSÈDE UNE TABLE : sur l'ENSEMBLE des mots, jamais sur un seul.
   La première version prenait `cleNorm(table).split('|')[0]`, c'est-à-dire le premier
   mot par ordre ALPHABÉTIQUE. Conséquences mesurées le 12/09/2026 sur QOS :
     · crm_leads donne « crm|lead », donc le mot retenu était « crm » ; crm_contacts
       donne « contact|crm », qui contient « crm » : convex/crm_contacts.ts était donc
       déclaré propriétaire de crm_leads alors que convex/crm_leads.ts existe. Trois
       signalements sur neuf portaient ce faux propriétaire.
     · socialPosts était possédée par « posts », contentItems par « content ».
   Un signalement dont le second côté est faux n'existe pas : c'est notre première loi.
   On compare donc les ensembles de mots, au singulier près, et on exige l'égalité.
   Une table dont aucun fichier ne porte le nom n'a pas de propriétaire, et on se tait :
   mieux vaut un silence qu'un propriétaire inventé. */
const singulier = (j) => j.replace(/s$/, '');
const motsDe = (nom) => new Set(cleNorm(nom || '').split('|').filter(Boolean).map(singulier));
const memeNom = (a, b) => {
  const A = motsDe(a), B = motsDe(b);
  if (!A.size || A.size !== B.size) return false;
  for (const m of A) if (!B.has(m)) return false;
  return true;
};

const ecrituresParTable = new Map();    // table → [{fichier, ligne, interne}]
for (const e of elements) {
  if (!ECRITURES.includes(e.classe) || !e.entite) continue;
  if (e.operation === 'default') continue;              // écrit par la base, pas par un module
  if (ECRIT_PARTOUT.test(e.fichier || '')) continue;
  if (!ecrituresParTable.has(e.entite)) ecrituresParTable.set(e.entite, []);
  ecrituresParTable.get(e.entite).push({ fichier: e.fichier, ligne: e.ligne, interne: estDuModule(e) });
}

const chezLeVoisin = [];
for (const [table, ou] of ecrituresParTable) {
  const ici = ou.find((x) => x.interne);
  if (!ici) continue;                                    // ce module n'écrit pas là : pas son affaire
  if (memeNom(nomModule(ici.fichier), table)) continue;  // c'est lui, le propriétaire
  const proprio = ou.find((x) => !x.interne && memeNom(nomModule(x.fichier), table));
  if (!proprio) continue;                                // personne ne la possède : on se tait
  chezLeVoisin.push({
    gravite: 2,
    concept: table,
    phrase: `« ${table} » : ce module écrit dans une table qu'il ne possède pas.`,
    ici: { ou: `${ici.fichier}:${ici.ligne}`, quoi: `écrit ${table}` },
    ailleurs: { ou: `${proprio.fichier}:${proprio.ligne}`, quoi: `propriétaire : ${nomModule(proprio.fichier)}`, combien: 1 },
  });
}

/* UN MODULE DE TRAVERSÉE N'EST PAS UN MODULE FAUTIF.
   Mesuré le 12/09/2026 : leadIngest.ts écrit dans crm_contacts, crm_leads et
   prospection_records. Trois constats exacts, et trois non-défauts : c'est le métier
   même d'un module d'ingestion de traverser les tables. La règle punissait donc
   l'architecture, et les trois modules les plus signalés de QOS étaient précisément
   ceux dont le rôle est de faire le lien.
   La vérification du 12/09 mesurait la VÉRACITÉ d'un signalement, pas sa NOCIVITÉ :
   cinq exacts ne font pas cinq utiles. Au-delà de deux tables étrangères écrites, ce
   n'est plus un débordement, c'est une fonction assumée, et on se tait. */
if (chezLeVoisin.length > 2) {
  console.log(`\n  (${chezLeVoisin.length} tables étrangères écrites : ce module en traverse plusieurs,`);
  console.log(`   c'est le propre d'un module d'ingestion ou de synchronisation. Rien signalé à ce titre.)`);
} else {
  desaccords.push(...chezLeVoisin);
}

/* ── 5. TROISIÈME DÉSACCORD : CETTE CRÉATION OUBLIE UN REPÈRE QUE LE PROPRIÉTAIRE POSE ──
   La comparaison descend de la TABLE au CHAMP. Pour une table donnée, ses créations
   forment une famille : si l'une d'elles oublie un champ que le module propriétaire pose
   à chaque fois, la ligne créée ici sera invisible à qui la cherche par ce champ.

   LE CRITÈRE, ET POURQUOI CELUI-LÀ. Mesuré le 12/09/2026, corpus des 140 défauts d'un
   côté, bruit sur trois dépôts sains de l'autre (plafond 40, départ 19) :

     · « tous sauf un » (n−1 poseurs sur n, n ≥ 3) ......... bruit 27, corpus 0
     · « le propriétaire le pose, les autres l'oublient » .. bruit 45, REFUSÉ au plafond
     · « le champ est lu quelque part » ................... bruit 58, REFUSÉ au plafond
     · « le champ sert de repère à un index » ............. bruit 37, corpus 1  (essayé,
       gardé une heure, puis annulé : il tirait 19 fois sur des cas du corpus avec la
       mauvaise phrase, et coûtait 18 signalements pour un cas)
     · LES DEUX À LA FOIS, ci-dessous .................... bruit 22, corpus 1

   « Tous sauf un » ne pouvait pas marcher et la mesure le dit : dans da-lab, cinq
   endroits créent une tâche, et c'est le PROPRIÉTAIRE (convex/taches.ts) qui pose seul
   `ordre`, `assigneType` et `source`. L'exception, c'est la norme, à un contre quatre.
   La majorité n'a donc pas raison ici : c'est le propriétaire qui a raison, parce que
   c'est lui qui écrit les requêtes qui relisent sa table.

   Et le propriétaire seul ne suffit pas : il pose quantité de champs de confort que les
   autres n'ont aucune raison de poser (45 signalements). Ce qui fait la différence entre
   un oubli et un choix, c'est qu'un INDEX prenne le champ pour repère : une ligne créée
   sans lui sort du résultat d'une requête que quelqu'un a écrite exprès.

   TROIS GARDE-FOUS, tous payés par la mesure :
     · une création qui n'est pas COMPLÈTE ne compte ni comme membre ni comme exception.
       Complète = elle pose tous les champs REQUIS du schéma et ne verse aucun objet
       étalé. Un `insert("taches", { ...args })` ne dit pas ce qu'il pose : sans ce
       filtre, da-lab sortait sept champs requis « manquants » qui étaient tous dans un
       étalement ;
     · le champ doit être OPTIONNEL au schéma. Un champ requis ne peut pas manquer sans
       que la base refuse l'écriture : s'il a l'air de manquer, c'est nous qui lisons mal.
       Un champ absent du schéma ne se juge pas non plus : on ne sait pas ;
     · on se tait si le propriétaire n'a aucune création complète, ou si c'est LUI qui
       omet le champ : il n'existe alors aucune norme à lui opposer. */

const sites = [];
for (const e of elements) {
  if (e.classe !== 'operation.ecriture' || !/^insert:/.test(e.nom || '')) continue;
  if (ECRIT_PARTOUT.test(e.fichier || '')) continue;
  sites.push({ table: e.nom.slice(7), fichier: e.fichier, ligne: e.ligne, fin: e.ligne, champs: new Set(), etale: false });
}
const sitesParFichier = new Map();
for (const s of sites) {
  if (!sitesParFichier.has(s.fichier)) sitesParFichier.set(s.fichier, []);
  sitesParFichier.get(s.fichier).push(s);
}
/* Un champ appartient à la création ouverte le plus près AU-DESSUS de lui, dans le même
   fichier et sur la même table : l'objet littéral suit l'appel. */
const siteDe = (e) => {
  let best = null;
  for (const s of sitesParFichier.get(e.fichier) || [])
    if (s.table === e.entite && s.ligne <= e.ligne + 1 && (!best || s.ligne > best.ligne)) best = s;
  return best;
};
for (const e of elements) {
  if (e.classe !== 'champ.ecrit' || e.operation !== 'insert' || !e.entite) continue;
  const s = siteDe(e); if (s) { s.champs.add(e.nom); s.fin = Math.max(s.fin, e.ligne); }
}
for (const e of elements) {
  if (e.classe !== 'ecriture.opaque' || !e.entite) continue;
  const s = siteDe(e); if (s && e.ligne <= s.fin + 1) s.etale = true;   // un étalement, dans CETTE création
}

const schemaDe = new Map();      // table → Map(champ → optionnel)
for (const e of elements) {
  if (e.classe !== 'champ.schema' || !e.entite) continue;
  if (!schemaDe.has(e.entite)) schemaDe.set(e.entite, new Map());
  schemaDe.get(e.entite).set(e.nom, !!e.optionnel);
}
const reperesDe = new Map();     // table → Set(champ nommé par un index)
for (const e of elements) {
  if (e.classe !== 'index' || !e.entite) continue;
  if (!reperesDe.has(e.entite)) reperesDe.set(e.entite, new Set());
  for (const c of e.champs || []) reperesDe.get(e.entite).add(c);
}

const famille = new Map();       // table → créations complètes
for (const s of sites) {
  const sch = schemaDe.get(s.table);
  if (!sch || s.etale) continue;
  let complete = true;
  for (const [c, opt] of sch) if (!opt && !s.champs.has(c)) { complete = false; break; }
  if (!complete) continue;
  if (!famille.has(s.table)) famille.set(s.table, []);
  famille.get(s.table).push(s);
}

for (const [table, membres] of famille) {
  if (membres.length < 2) continue;                       // pas de famille : rien à comparer
  const sch = schemaDe.get(table);
  const reperes = reperesDe.get(table) || new Set();
  const proprios = membres.filter((m) => memeNom(nomModule(m.fichier), table));
  if (!proprios.length) continue;                         // table sans propriétaire : aucune norme
  for (const ici of membres) {
    if (!estDuModule(ici)) continue;                      // on ne rapporte que le module en cours
    if (memeNom(nomModule(ici.fichier), table)) continue; // c'est lui le propriétaire : il fait la norme
    for (const champ of reperes) {
      if (ici.champs.has(champ)) continue;
      if (!sch.get(champ)) continue;                      // requis, ou hors schéma : pas notre affaire
      if (!proprios.every((p) => p.champs.has(champ))) continue;   // le propriétaire hésite : on se tait
      const poseurs = membres.filter((m) => m.champs.has(champ));
      desaccords.push({
        gravite: 2,
        concept: `${table}.${champ}`,
        phrase: `« ${table}.${champ} » : cette création oublie un champ que le propriétaire de la table pose toujours, et qu'un index prend pour repère.`,
        ici: { ou: `${ici.fichier}:${ici.ligne}`, quoi: `crée ${table} sans ${champ}` },
        ailleurs: { ou: `${proprios[0].fichier}:${proprios[0].ligne}`, quoi: `${nomModule(proprios[0].fichier)} y pose ${champ}`, combien: poseurs.length },
      });
    }
  }
}

/* ── 6. LE RAPPORT, CINQ LIGNES AU PLUS ────────────────────────────────────────
   Les plus graves d'abord : écrire chez quelqu'un d'autre casse une garantie, lire
   ailleurs affiche un chiffre faux. Les deux comptent, l'écriture d'abord. */

/* Le tri départageait sur `ailleurs.combien`, qui vaut 1 en dur pour toute écriture :
   sur un fichier fourre-tout, c'était donc l'ordre d'itération d'une Map qui décidait
   des cinq montrés. À gravité égale, on tranche sur le poids de la référence puis sur
   le nom, ce qui rend au moins la sortie STABLE d'une exécution à l'autre. */
desaccords.sort((x, y) => (y.gravite - x.gravite)
  || (y.ailleurs.combien - x.ailleurs.combien)
  || String(x.concept).localeCompare(String(y.concept))
  || String(x.ici.ou).localeCompare(String(y.ici.ou)));
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

#!/usr/bin/env node
/**
 * lexical.mjs — un concept, une source. Et un propriétaire.
 *
 *     node lexical.mjs <repo> [--json f] [--seuil 2]
 *
 * LE PROBLÈME, tel que Thomas le formule
 *
 * « Si dans tout un SaaS il y a quatre modules qui traitent de rendez-vous, les noms
 * peuvent être différents : RDV, rendez-vous, visite, agenda. Il faut identifier tous
 * ces mots, comprendre que c'est la même chose, et exiger qu'ils soient connectés à la
 * même source. »
 *
 * C'est le défaut le plus coûteux et le moins visible de nos produits : personne ne
 * remarque que deux écrans lisent deux tables différentes pour dire la même chose,
 * jusqu'au jour où ils affichent deux chiffres différents devant le client.
 *
 * DEUX RÈGLES, ET ELLES SONT SYMÉTRIQUES
 *
 *   UNE SOURCE     tout ce qui parle du même concept doit LIRE au même endroit.
 *                  Sur projet client A : « Biens actifs 7 » lit une table de démonstration de
 *                  9 lignes pendant que « 21 biens », dix centimètres plus bas, lit le
 *                  vrai parc. Une donnée, deux sources, deux chiffres.
 *   UN PROPRIÉTAIRE  tout ce qui ÉCRIT un concept passe par son module. Sur projet client A, la
 *                  table des tâches est écrite depuis sept endroits : l'agenda, les
 *                  agents, le moteur, les comptes rendus… Personne ne possède le
 *                  concept, donc personne ne garantit qu'une tâche ressemble à une tâche.
 *
 * COMMENT ON SAIT QUE DEUX MOTS DÉSIGNENT LA MÊME CHOSE
 *
 * Par le lexique (`lexique.mjs`), qui ramène chaque nom à son concept : `rendezVous`,
 * `visitesDeLaSemaine`, `crm_evenements`, `agendaDuJour` et `calendrier` donnent tous
 * « rdv ». La partie métier de ce lexique est la seule qu'aucun outil ne peut deviner :
 * elle se valide avec l'humain, et c'est pour ça qu'elle est écrite en clair.
 */

import fs from 'node:fs';
import path from 'node:path';
import { extraire } from './extraire.mjs';
import { cleNorm } from './lexique.mjs';
import { refuser } from './adapters/bases.mjs';

const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SEUIL = Number(arg('--seuil', 2));

/* Ce qui écrit partout et a le droit de le faire. Sans cette liste, le fichier de
   données de démonstration et les migrations sortent en tête de tous les rapports. */
const ECRIT_PARTOUT = /(^|\/)(seed|seeds|fixtures?|migration|migrations|backfill|_generated|scripts)\b/i;

/* Un concept trop générique ne veut rien dire : le regrouper produit du bruit. */
const TROP_VAGUE = new Set(['date', 'statut', 'nom', 'actif', 'note', 'id', 'total', 'type', 'montant']);

/* Un VERBE n'est pas un concept de donnée. « créer », « lister », « supprimer »
   existent dans tous les modules et c'est normal : les regrouper sortait 130 faux
   constats dont les cinq premiers étaient des verbes. */
const VERBES = new Set(['creer', 'enregistrer', 'supprimer', 'modifier', 'lister', 'liste',
  'obtenir', 'chercher', 'compter', 'basculer', 'archiver', 'envoyer', 'ouvrir', 'fermer',
  'ajouter', 'retirer', 'marquer', 'valider', 'annuler', 'charger', 'maj', 'creation']);

const { elements } = extraire(RACINE);

/* ── LE REFUS DE CONCLURE ───────────────────────────────────────────────────────
   Les deux règles de ce fichier se calculent sur les tables et sur les écritures. Sans
   table, `ENTITES` est vide, la règle 1 ne compare rien ; sans écriture, la règle 2 n'a
   aucun auteur à opposer. Le script affichait alors « Rien à signaler » et sortait en
   code 0, sur des projets qui avaient une table écrite depuis trois modules. Mesuré le
   2026-09-12 sur les trois bancs `banc/stacks/` : trois mensonges sur trois.

   La loi du skill donne trois codes : 0 rien à signaler · 1 des défauts · 2 le travail
   n'a pas pu être fait. Une extraction vide est le troisième cas, jamais le premier. */
const _tables = elements.filter((e) => e.classe === 'table');
const _ecritures = elements.filter((e) => ['operation.ecriture', 'champ.ecrit', 'operation.suppression'].includes(e.classe));
if (!_tables.length) refuser('table', RACINE, 'Sans table, « un concept, une source » et « un concept, un propriétaire » ne comparent rien.');
if (!_ecritures.length) refuser('écriture en base', RACINE, `${_tables.length} table(s) reconnue(s), mais aucune écriture : je ne peux désigner aucun propriétaire.`);

/* On ne compare QUE les concepts qui désignent une entité réellement stockée. Un
   concept sans table derrière est un attribut ou une action, pas une donnée qu'on
   pourrait lire à deux endroits différents. Ce filtre se calcule, il ne s'écrit pas. */
const ENTITES = new Set();
for (const e of elements) {
  if (e.classe !== 'table') continue;
  for (const c of cleNorm(e.nom || '').split('|')) if (c && c.length >= 3) ENTITES.add(c);
}

/* ── Règle 1 · un concept, une source ──────────────────────────────────────────
   Pour chaque lecture, on note le concept dont elle parle et la table qu'elle lit. */
const lectures = new Map();       // concept → Map(table → [où])
for (const e of elements) {
  if (!['champ.projection', 'champ.affiche', 'fonction.serveur'].includes(e.classe)) continue;
  if (!e.entite) continue;
  for (const c of cleNorm(e.nom || '').split('|')) {
    if (!c || c.length < 3 || TROP_VAGUE.has(c) || VERBES.has(c) || !ENTITES.has(c)) continue;
    if (!lectures.has(c)) lectures.set(c, new Map());
    const m = lectures.get(c);
    if (!m.has(e.entite)) m.set(e.entite, []);
    m.get(e.entite).push(`${e.fichier}:${e.ligne}`);
  }
}

const sourcesMultiples = [...lectures]
  .filter(([, m]) => m.size >= SEUIL)
  .map(([concept, m]) => ({
    concept,
    sources: [...m].map(([table, ou]) => ({ table, n: ou.length, ou: ou.slice(0, 3) }))
      .sort((a, b) => b.n - a.n),
  }))
  .sort((a, b) => b.sources.length - a.sources.length);

/* ── Règle 2 · un concept, un propriétaire ─────────────────────────────────────
   Qui écrit dans chaque table, et depuis quel module. */
const ecritures = new Map();      // table → Map(module → n)
for (const e of elements) {
  if (!['operation.ecriture', 'champ.ecrit', 'operation.suppression'].includes(e.classe)) continue;
  // Une valeur par défaut est écrite par la BASE, pas par un module : elle ne fait de
  // personne le propriétaire ni le locataire d'une table.
  if (e.operation === 'default') continue;
  const t = e.entite; if (!t) continue;
  const mod = (e.fichier || '').replace(/\.[jt]sx?$/, '');
  if (ECRIT_PARTOUT.test(mod)) continue;
  if (!ecritures.has(t)) ecritures.set(t, new Map());
  const m = ecritures.get(t);
  m.set(mod, (m.get(mod) || 0) + 1);
}

/* En App Router, TOUS les fichiers s'appellent « route » ou « page » : le nom qui
   désigne le module est celui du dossier. Sans ça, le rapport dit « écrite aussi par :
   route, route, route », ce qui n'aide personne, et une table écrite depuis
   `app/api/factures/route.ts` n'a jamais de propriétaire alors qu'elle en a un. */
const nomModule = (m) => {
  const b = path.basename(m);
  return /^(route|page|index|handler|actions|action)$/.test(b) ? (path.basename(path.dirname(m)) || b) : b;
};

/* Le propriétaire légitime d'une table est le module qui porte son nom. Tout autre
   module qui y écrit est un locataire : c'est lui qu'on signale, pas le propriétaire. */
const sansProprietaire = [...ecritures]
  .map(([table, m]) => {
    const c = cleNorm(table).split('|')[0];
    const proprio = [...m.keys()].find((mod) => cleNorm(nomModule(mod)).split('|').includes(c));
    const locataires = [...m.keys()].filter((mod) => mod !== proprio);
    return { table, proprietaire: proprio || null, locataires, n: m.size };
  })
  .filter((x) => x.locataires.length >= SEUIL)
  .sort((a, b) => b.locataires.length - a.locataires.length);

const R = { racine: RACINE, sourcesMultiples, sansProprietaire };

console.log(`\n  LIENS LOGIQUES — ${path.basename(RACINE)}`);
console.log(`  ${'-'.repeat(72)}`);

if (sourcesMultiples.length) {
  console.log(`\n  UN CONCEPT, PLUSIEURS SOURCES  (${sourcesMultiples.length})`);
  console.log(`  Ces écrans parlent de la même chose et ne lisent pas au même endroit.\n`);
  for (const d of sourcesMultiples.slice(0, 10)) {
    console.log(`  « ${d.concept} » est lu depuis ${d.sources.length} sources :`);
    for (const s of d.sources.slice(0, 4)) {
      console.log(`      ${String(s.n).padStart(3)}× ${s.table}   ex. ${s.ou[0]}`);
    }
    console.log();
  }
}

if (sansProprietaire.length) {
  console.log(`\n  UN CONCEPT, PLUSIEURS AUTEURS  (${sansProprietaire.length})`);
  console.log(`  Ces données sont écrites depuis des modules qui ne les possèdent pas.\n`);
  for (const d of sansProprietaire.slice(0, 10)) {
    console.log(`  « ${d.table} » — propriétaire ${d.proprietaire ? nomModule(d.proprietaire) : 'AUCUN'}`);
    console.log(`      écrite aussi par : ${d.locataires.map(nomModule).slice(0, 6).join(', ')}`);
  }
  console.log();
}

if (!sourcesMultiples.length && !sansProprietaire.length) console.log('\n  Rien à signaler.\n');

const j = arg('--json', null);
if (j) fs.writeFileSync(path.resolve(j), JSON.stringify(R, null, 1));
process.exitCode = sourcesMultiples.length + sansProprietaire.length ? 1 : 0;

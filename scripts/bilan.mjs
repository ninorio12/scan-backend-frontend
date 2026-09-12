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
 * LES AGENTS ENTRENT ICI. `.backend/parcours/` porte les rapports des agents qui sont
 * entrés dans l'application (`scripts/parcours.mjs`, `references/parcours-reel.md`).
 * Leurs constats entrent dans les MÊMES familles, sur la MÊME échelle, avec une mention
 * de ce que la vérification en a dit : confirmé, invérifiable, ou « rapporté, non
 * vérifié ». Ce qui est infirmé n'entre pas. Leur décompte alimente la couverture, et un
 * groupe lancé qui n'a jamais rendu apparaît en « non regardé », nommément. Avant le
 * 12/09/2026, rien de tout ça n'était lu : six agents avaient trouvé les dix défauts les
 * plus graves d'un produit, et aucun n'apparaissait dans ce fichier.
 *
 * UN CHIFFRE D'UNE ÉTAPE NON FAITE N'APPARAÎT JAMAIS. Le 12/09/2026, ce rapport disait
 * dans la même page « 19 fausses données en base » et « la base n'a pas été inspectée » :
 * `couverture.json` gardait en mémoire l'échec du matin, `fausses-en-base.json` portait
 * l'inspection de l'après-midi, et personne ne réconciliait les deux. Désormais l'ARTEFACT
 * fait foi sur la mémoire de la chaîne (fonction `reconcilier`), et la section « fausse
 * donnée en base » ne peut pas exister sans une inspection de base réussie.
 *
 * CODES DE SORTIE : 0 sain · 1 des problèmes · 2 incomplet (INCONNU).
 */

import fs from 'node:fs';
import path from 'node:path';
import { dossierBackend } from './dossier-backend.mjs';
import { lireParcours } from './parcours.mjs';

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
const parcours = lireParcours(RACINE);

/* ── L'ARTEFACT FAIT FOI SUR LA MÉMOIRE DE LA CHAÎNE ──────────────────────────
   `couverture.json` garde l'état des étapes au moment où la chaîne a tourné. Si une
   étape a échoué à 10 h et qu'on l'a rejouée seule à 13 h, son fichier de sortie existe
   et il est plus récent : c'est lui qui dit la vérité. Sans ça, le même rapport annonce
   un chiffre et, deux sections plus bas, qu'il n'a pas regardé d'où il vient.
   On ne devine jamais dans l'autre sens : un artefact absent reste un « non fait ».  */
const ARTEFACT_DE_L_ETAPE = {
  reconnaitre: 'reconnaissance.json', scan: 'scan.json', lexical: 'lexical.json',
  'fausses-donnees': 'fausses.json', 'nettoyer-base': 'fausses-en-base.json',
  liens: 'liens.json', decisions: 'questions.json',
};
const dateDe = (f) => { try { return fs.statSync(path.join(D, f)).mtimeMs; } catch { return 0; } };
const dateCouverture = dateDe('couverture.json');
const rejouees = [];
function reconcilier(nomEtape) {
  const f = ARTEFACT_DE_L_ETAPE[nomEtape];
  if (!f) return false;
  const t = dateDe(f);
  if (!t || t < dateCouverture) return false;
  const phrase = `${nomEtape} : rejouée seule après la chaîne (${f} plus récent que couverture.json), c'est son résultat qui fait foi`;
  if (!rejouees.includes(phrase)) rejouees.push(phrase);
  return true;
}
/* La même réconciliation pour les phrases libres de `raccourcis`, qui ne portent pas de
   nom d'étape : on ne reconnaît que celles dont on sait quel artefact les dément. */
const RACCOURCI_DE_L_ETAPE = [[/la base n'a pas été inspectée/i, 'nettoyer-base']];

/* La base a-t-elle VRAIMENT été ouverte ? Un seul endroit le dit, et c'est le fichier
   qu'écrit nettoyer-base.mjs quand il a compté des documents. Tout chiffre « en base »
   passe par ce verrou : pas d'inspection, pas de chiffre. */
const baseInspectee = !!enBase && enBase.inspectee !== false && (!enBase.statut || enBase.statut === 'inspectée');

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
if (baseInspectee && enBase.suspects) {
  for (const t of enBase.parTable || []) {
    ajouter(TROMPE, 'fausse donnée en base', `${t.suspects.length} documents dans « ${t.table} »`,
      `${t.lignes} documents au total`, 'cohabitent avec les vraies fiches du client');
  }
}

/* ── Ce que les agents ont trouvé, dans les mêmes familles et sur la même échelle ──
   Un constat n'entre jamais « confirmé » sans vérification : il entre « rapporté, non
   vérifié », et le lecteur sait ce qu'il tient. Ce qui a été infirmé n'entre pas du
   tout : c'est `parcours.mjs` qui l'a écarté, et le bilan le dit plus bas. */
for (const c of parcours.constats) {
  if (!c.retenu) continue;
  const famille = c.famille ? `parcours : ${c.famille}` : `parcours : constat d'agent (${NIVEAU[c.gravite]})`;
  const mention = c.statut === 'confirmé' ? 'confirmé par contre-épreuve'
    : c.statut === 'rapporté, non vérifié' ? 'rapporté par un agent, non vérifié mécaniquement'
      : `${c.statut}${c.raison ? ` : ${c.raison}` : ''}`;
  ajouter(c.gravite, famille, c.quoi, c.ecran || '', `[${c.groupe} · ${mention}]${c.preuve ? ` ${c.preuve}` : ''}`);
}

/* ── Les démentis : une mesure ne se retire que rejouée ────────────────────────
   Cinq agents ont démenti « 256 boutons morts » le 12/09/2026, et ils avaient raison.
   Mais on ne retire pas un chiffre mesuré sur la parole d'un agent : le démenti doit
   avoir été rejoué par `verifier-affirmation.mjs` et tenir. Sinon le constat reste. */
const retires = [];
const normaliser = (s) => String(s ?? '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
for (const d of parcours.dementis) {
  if (!d.tient) continue;
  const cf = normaliser(d.cible.famille), cl = normaliser(d.cible.libelle);
  const ce = normaliser(d.cible.ecran), co = normaliser(d.cible.ou);
  /* Une cible vide viserait tout : un démenti sans cible ne retire rien. */
  if (!cf && !cl && !ce && !co) continue;
  for (let i = trouve.length - 1; i >= 0; i--) {
    const t = trouve[i];
    /* Un démenti vise une MESURE, jamais le constat d'un autre agent : on n'arbitre pas
       entre deux agents à coups de démentis croisés. */
    if (/^parcours : /.test(t.famille)) continue;
    if (cf && normaliser(t.famille) !== cf) continue;
    if (cl && normaliser(t.quoi) !== cl) continue;
    if (ce && !normaliser(t.ou).endsWith(ce)) continue;
    if (co && !normaliser(t.ou).includes(co)) continue;
    retires.push({ ...t, par: d.groupe, pourquoi: d.pourquoi, raison: d.raison });
    trouve.splice(i, 1);
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
/* Les raccourcis et les étapes de la chaîne, PASSÉS AU FILTRE DE L'ARTEFACT : une étape
   rejouée seule depuis n'est plus un « non fait », et sa phrase ne doit plus sortir. */
for (const r of couv?.raccourcis || []) {
  const etapeVisee = (RACCOURCI_DE_L_ETAPE.find(([re]) => re.test(r)) || [])[1];
  if (etapeVisee && reconcilier(etapeVisee)) continue;
  if (!nonFait.some((n) => n.includes(r))) nonFait.push(r);
}
for (const [nom, e] of Object.entries(couv?.etapes || {})) {
  const echec = (e && typeof e === 'object' && /échec|erreur/i.test(e.statut || ''))
    || (typeof e === 'string' && /échec|erreur/i.test(e));
  if (!echec) continue;
  if (reconcilier(nom)) continue;
  nonFait.push(typeof e === 'string' ? `${nom} : ${e}` : `${nom} : ${e.statut}${e.raison ? ` (${e.raison})` : ''}`);
}

/* ── La base : une seule phrase, et rien d'autre sur la base ──────────────────
   Tant qu'elle n'est pas ouverte, le bilan ne dit rien d'elle sauf comment l'ouvrir.
   Le format de l'export est écrit noir sur blanc : l'épreuve du 12/09 a dû le deviner. */
const EXPORT_ATTENDU = 'un dossier avec un .jsonl par table (voir references/parcours-reel.md § « la base non Convex »)';
if (!baseInspectee) {
  const ligneBase = enBase?.statut === 'sautée'
    ? null
    : !enBase
      ? `base non inspectée : fournir --export <dossier> à couverture.mjs (ou à nettoyer-base.mjs) — ${EXPORT_ATTENDU}`
      : `base non inspectée : ${enBase.raison || enBase.statut} — fournir --export <dossier>, ${EXPORT_ATTENDU}`;
  if (ligneBase) nonFait.push(ligneBase);
  else notes.push(`base non exportée : ${enBase.raison}`);
}

/* ── Le passage des agents ────────────────────────────────────────────────────
   Un groupe lancé qui n'a jamais rendu est une ligne du rapport, pas un silence :
   le 12/09/2026, un groupe sur six n'est jamais revenu et trois modules du produit
   n'ont eu que le passage mécanique. Personne ne l'aurait su en lisant ce fichier. */
for (const g of parcours.manquants) {
  nonFait.push(`parcours agent : le groupe « ${g.groupe} » n'a jamais rendu de rapport`
    + `${g.ecrans?.length ? ` : ${g.ecrans.join(', ')} n'ont pas eu de passage agent` : ''}`);
}
for (const i of parcours.incomplets) {
  nonFait.push(`parcours agent : le rapport du groupe « ${i.groupe} » n'est pas fini (manque : ${i.manques.join(', ')}) : on relance`);
}
for (const g of parcours.groupes) {
  if (!g.totaux.non_testes) continue;
  nonFait.push(`parcours agent [${g.groupe}] : ${g.totaux.non_testes} élément(s) voulus et pas atteints — ${g.pourquoi_non_testes.join(' ; ')}`);
}
for (const r of rejouees) notes.push(r);
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

/* ── Le parcours des agents : la couverture, et ce que vaut leur parole ────── */
if (parcours.existe) {
  const P = parcours;
  const ecartes = P.constats.filter((c) => !c.retenu);
  md += `## Parcours des agents\n\n`;
  md += `${P.groupes.length} groupe(s) ont rendu${P.manquants.length ? ` sur ${P.groupes.length + P.manquants.length} lancés` : ''}. `;
  md += `Leur décompte compte dans la couverture au même titre que le passage mécanique. `;
  md += `Le taux de confirmation est celui des constats tranchés du groupe (confirmés sur confirmés + infirmés) ; `;
  md += `les démentis se lisent plus bas, ils ont leur propre règle.\n\n`;
  md += `| groupe | écrans | recensés | cliqués | écartés | non testés | non concluants | constats | confirmation |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const g of P.groupes) {
    md += `| ${g.groupe} | ${(g.ecrans || []).join(' ')} | ${g.totaux.recenses} | ${g.totaux.cliques} | ${g.totaux.ecartes} `
      + `| ${g.totaux.non_testes} | ${g.totaux.non_concluants} | ${g.anomalies} `
      + `| ${g.tauxConfirmation == null ? (g.verifie ? '—' : 'non vérifié') : `${Math.round(g.tauxConfirmation * 100)} %`} |\n`;
  }
  for (const g of P.manquants) md += `| ${g.groupe} | ${(g.ecrans || []).join(' ')} | — | — | — | — | — | — | **n'a jamais rendu** |\n`;
  md += `| **total** | | ${P.totaux.recenses} | ${P.totaux.cliques} | ${P.totaux.ecartes} | ${P.totaux.non_testes} | ${P.totaux.non_concluants} | ${P.constats.length} | |\n\n`;
  const retenus = P.constats.filter((c) => c.retenu);
  md += `${retenus.filter((c) => c.statut === 'confirmé').length} constat(s) confirmés par contre-épreuve · `
    + `${retenus.filter((c) => /invérifiable|hors-sujet/.test(c.statut)).length} invérifiables · `
    + `${retenus.filter((c) => c.statut === 'rapporté, non vérifié').length} rapportés non vérifiés · `
    + `${ecartes.length} écartés par la vérification.\n\n`;
  if (ecartes.length) {
    md += `### Écarté par la vérification : ${ecartes.length}\n\n`;
    md += `Ces constats d'agents ont été rejoués et infirmés. Ils n'entrent pas au bilan.\n\n`;
    for (const c of ecartes) md += `- [${c.groupe}] ${c.quoi}${c.ecran ? ` · \`${c.ecran}\`` : ''}\n  ${c.raison || 'infirmé'}\n`;
    md += `\n`;
  }
  if (retires.length) {
    md += `### Retiré du bilan par contre-épreuve d'agent : ${retires.length}\n\n`;
    md += `Des constats MÉCANIQUES que des agents ont rejoués et démentis, vérification à l'appui.\n`;
    md += `Un démenti non vérifié ne retire rien : une mesure ne se retire pas sur parole.\n\n`;
    const parFamille = {};
    for (const r of retires) (parFamille[r.famille] ||= []).push(r);
    for (const [f, l] of Object.entries(parFamille)) {
      md += `- ${f} : ${l.length} retirés (${[...new Set(l.map((x) => x.quoi))].slice(0, 8).join(', ')})\n`;
      md += `  ${l[0].pourquoi || ''} ${l[0].raison ? `· ${l[0].raison}` : ''}\n`;
    }
    md += `\n`;
  }
  const dementisFaibles = parcours.dementis.filter((d) => !d.tient);
  if (dementisFaibles.length) {
    md += `### Démentis qui ne tiennent pas : ${dementisFaibles.length}\n\n`;
    for (const d of dementisFaibles) {
      md += `- [${d.groupe}] ${d.cible.famille || '?'} « ${d.cible.libelle || '?'} » : `
        + `${d.disposition ? `rejoué et ${d.disposition}` : 'jamais rejoué'}, le constat mécanique reste.\n`;
    }
    md += `\n`;
  }
  if (parcours.traces.length) {
    md += `### Données de test laissées par les agents : ${parcours.traces.length}\n\n`;
    md += `À retirer devant la liste, avec quelqu'un qui connaît le métier. Le skill ne supprime rien.\n\n`;
    for (const t of parcours.traces) md += `- [${t.groupe}] ${t.quoi}\n`;
    md += `\n`;
  }
}

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
if (parcours.existe) {
  const retenus = parcours.constats.filter((c) => c.retenu);
  const ecartes = parcours.constats.length - retenus.length;
  console.log(`  ${'-'.repeat(72)}`);
  console.log(`  PARCOURS DES AGENTS · ${parcours.groupes.length} groupe(s) rendu(s)`
    + `${parcours.manquants.length ? ` sur ${parcours.groupes.length + parcours.manquants.length} lancés` : ''}`);
  console.log(`    recensés ${parcours.totaux.recenses} · cliqués ${parcours.totaux.cliques} · écartés ${parcours.totaux.ecartes}`
    + ` · non testés ${parcours.totaux.non_testes} · non concluants ${parcours.totaux.non_concluants}`);
  console.log(`    ${retenus.length} constat(s) entrés au bilan (${retenus.filter((c) => c.statut === 'confirmé').length} confirmés, `
    + `${retenus.filter((c) => /invérifiable|hors-sujet/.test(c.statut)).length} invérifiables, `
    + `${retenus.filter((c) => c.statut === 'rapporté, non vérifié').length} non vérifiés) · ${ecartes} écarté(s) par la vérification`);
  if (retires.length) console.log(`    ${retires.length} constat(s) mécanique(s) retirés par contre-épreuve d'agent`);
  for (const g of parcours.manquants) console.log(`      ⚠️  ${g.groupe} n'a jamais rendu : ${(g.ecrans || []).join(', ')}`);
}
for (const r of rejouees) console.log(`      · ${r}`);
for (const n of nonFait) console.log(`      ⚠️  ${n.replace(/(.{76}\s)/g, '$1\n          ')}`);
for (const n of notes) console.log(`      · ${n}`);
console.log(`\n  ${sortie}\n`);
process.exitCode = nonFait.length ? 2 : (trouve.length ? 1 : 0);

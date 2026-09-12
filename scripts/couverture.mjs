#!/usr/bin/env node
/**
 * couverture.mjs : LA chaîne. Tout le code, tous les modules, tous les boutons, et la
 * preuve de ce qui n'a pas été regardé.
 *
 *     node couverture.mjs <repo> [--url http://localhost:3000] [--paralleles 3]
 *                                [--rapide] [--sans-base] [--export <zip|dossier>] [--json f]
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Les outils du skill savent chacun faire une chose. Aucun ne savait dire **ce qui n'a
 * pas été regardé**. On annonçait « l'écran Paramètres est propre » après avoir cliqué
 * seize boutons sur deux cent quatorze, sans que le chiffre apparaisse nulle part.
 *
 * Ici, le résultat n'est pas la liste des défauts : c'est le TABLEAU DE COUVERTURE.
 * Combien de modules sur combien. Combien de boutons cliqués sur combien recensés. Ce
 * qui a été volontairement écarté, et pourquoi. Un module non testé est une ligne du
 * rapport, pas un silence.
 *
 * CE QU'IL ENCHAÎNE, dans cet ordre, et rien d'autre ne l'enchaîne
 *
 *   1. reconnaitre.mjs       le projet : cadre, pages, schéma  → reconnaissance.json
 *   2. scan.mjs              le scanner voit, l'apparieur juge  → scan.json
 *   3. lexical.mjs           un concept une source, un propriétaire → lexical.json
 *   4. fausses-donnees.mjs   ce que les fichiers d'injection ont semé → fausses.json
 *   5. nettoyer-base.mjs     les fausses données restées EN BASE → fausses-en-base.json
 *                            (seulement si l'export réussit ; sinon « non fait : raison »)
 *   6. les écrans, EN PARALLÈLE, un travailleur par écran (--paralleles N, 3 par défaut) :
 *        liens.mjs           où mènent les liens, une fois pour toute l'application
 *        clics.mjs           tous les boutons d'un écran, un verdict chacun
 *        apparence.mjs       à quoi il ressemble, en grand et en téléphone
 *      L'ÉCRAN est l'unité d'isolation : un processus, un navigateur, un décompte.
 *      Jamais une tranche de boutons : ses boutons partagent un état.
 *   7. decisions.mjs         les questions que seul l'humain peut trancher → questions.json
 *   8. bilan.mjs             le baromètre, un seul document → BILAN.md
 *
 * CE QU'IL NE FAIT PAS : cliquer sur ce qui supprime, vide, déconnecte ou ÉCRIT (type=submit,
 * bouton dans un formulaire, verbe d'écriture). Ces boutons sont comptés « écartés »,
 * nommément, dans le tableau. Ils ne disparaissent pas du décompte : on sait exactement
 * ce qui reste à vérifier par un agent avec consentement, ou à la main.
 *
 * LES CODES DE SORTIE DES ENFANTS FONT FOI : 0 fait et propre · 1 fait, avec défauts ·
 * 2 (ou tué, ou planté) NON FAIT, avec la raison, et ça nourrit TRAVAIL INCOMPLET. Avant,
 * un enfant sorti en code 2 avec du texte sur stdout passait pour un ✓.
 *
 * TOUT CE QUI EST ÉCRIT VA DANS <repo>/.backend/ : jamais ailleurs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { dossierBackend, ecrireJson } from './dossier-backend.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const a = (n) => process.argv.includes(n);
const PARALLELES = Math.max(1, Number(arg('--paralleles', 3)) || 3);
/* Le seul endroit où l'on écrit : <repo>/.backend/, via dossier-backend.mjs, qui y pose
   le .gitignore. Tout JSON passe par ecrireJson : jamais un writeFileSync direct. */
const SORTIE = dossierBackend(RACINE);
const F = (nom) => path.join(SORTIE, nom);

/* Une étape de la chaîne, jugée sur le code de sortie de l'enfant, dans le format que
   bilan.mjs lit : statut « fait » / « échec » / « sauté », raison, code. */
const etape = (r, saute = null) => saute
  ? { statut: 'sauté', raison: saute, code: null }
  : r.ok ? { statut: 'fait', raison: r.defauts ? 'défauts trouvés' : null, code: r.code }
    : { statut: 'échec', raison: r.raison, code: r.code };

if (!fs.existsSync(RACINE) || !fs.statSync(RACINE).isDirectory()) {
  console.error(`  ⛔ ${RACINE} n'est pas un dossier.`); process.exit(2);
}

/* ── Lancer un enfant et le JUGER SUR SON CODE DE SORTIE ───────────────────────
   0 et 1 = fait (1 : des défauts, c'est le fonctionnement normal). Tout le reste =
   non fait, et on garde la ligne ⛔ de l'enfant comme raison. Et quand l'enfant doit
   écrire un fichier (`attendu`), « fait » exige que le fichier existe : un script qui
   plante en code 1 avec une pile d'appels n'a pas « trouvé des défauts ». */
function lancer(script, args, minutes = 10, attendu = null) {
  if (attendu) { try { fs.unlinkSync(attendu); } catch { /* n'existait pas */ } }
  return new Promise((resolve) => {
    const p = spawn('node', [path.join(ICI, script), ...args], { cwd: RACINE, env: process.env });
    let sortie = '', erreur = '';
    p.stdout.on('data', (d) => { sortie += d; });
    p.stderr.on('data', (d) => { erreur += d; });
    const minuteur = setTimeout(() => p.kill('SIGKILL'), minutes * 60000);
    p.on('close', (code, signal) => {
      clearTimeout(minuteur);
      let ok = code === 0 || code === 1;
      const ligne = () => (sortie.match(/⛔[^\n]*/) || [])[0]
        || erreur.split('\n').map((l) => l.trim()).find((l) => l && !/^\s*at /.test(l))
        || sortie.trim().split('\n').pop() || '';
      let raison = null;
      if (!ok) {
        raison = signal ? `tué après ${minutes} min (${signal})`
          : `code ${code}${ligne() ? ` : ${ligne().replace(/^⛔\s*/, '').slice(0, 160)}` : ''}`;
      } else if (attendu && !fs.existsSync(attendu)) {
        ok = false;
        raison = `code ${code} mais ${path.basename(attendu)} non écrit${ligne() ? ` : ${ligne().slice(0, 140)}` : ''}`;
      }
      resolve({ ok, code, signal, sortie, erreur, raison, defauts: ok && code === 1 });
    });
    p.on('error', (e) => { clearTimeout(minuteur); resolve({ ok: false, code: null, sortie, erreur: String(e), raison: `impossible à lancer : ${e.message}` }); });
  });
}

const lireJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── Les modules : on les prend dans le code, pas à la main ────────────────────
   Une page = un module à tester. Les segments dynamiques ([ref]) sont listés mais
   marqués « non testés sans identifiant » plutôt que passés sous silence. */
function modules() {
  const out = [];
  const marcher = (d, base = '') => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/node_modules|\.next|_generated/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marcher(p, `${base}/${e.name}`);
      else if (e.name === 'page.tsx' || e.name === 'page.jsx') {
        out.push({ route: base || '/', dynamique: /\[/.test(base) });
      }
    }
  };
  /* Next met les pages dans `app/` OU `src/app/` selon le projet, et `pages/` en
     Pages Router. Ne chercher qu'à un endroit rendait l'outil muet sur deux de nos
     trois SaaS : il annonçait « 0 page trouvée » sans le dire. */
  for (const base of ['app', 'src/app', 'pages', 'src/pages']) marcher(path.join(RACINE, base));
  // Les groupes de routes Next, (app), (auth), ne sont pas dans l'URL.
  return out.map((m) => ({ ...m, route: m.route.replace(/\/\([^)]+\)/g, '') || '/' }));
}

/* Une file de travail : N travailleurs, une tâche = un écran entier. */
async function enParallele(taches, n) {
  const resultats = new Array(taches.length);
  let i = 0;
  const travailleur = async () => {
    while (i < taches.length) { const k = i++; resultats[k] = await taches[k](); }
  };
  await Promise.all(Array.from({ length: Math.min(n, taches.length) }, travailleur));
  return resultats;
}

const T0 = Date.now();
const nomFichier = (route) => route.replace(/\W+/g, '_').replace(/^_/, '') || 'racine';   // /modules/biens → modules_biens
const R = { racine: RACINE, date: new Date().toISOString(), paralleles: PARALLELES, etapes: {}, ecrans: [], ecartes: [] };
const nonFait = [];   // TRAVAIL INCOMPLET : chaque ligne nomme ce qui n'a pas été fait, et pourquoi

console.log(`\n  COUVERTURE : ${path.basename(RACINE)}`);
console.log(`  ${'='.repeat(74)}`);

/* ══ 1. RECONNAÎTRE ═════════════════════════════════════════════════════════ */

process.stdout.write(`\n  RECONNAISSANCE            `);
const rr = await lancer('reconnaitre.mjs', [RACINE, '--json', F('reconnaissance.json')], 5, F('reconnaissance.json'));
const carte = rr.ok ? lireJson(F('reconnaissance.json')) : null;
R.etapes.reconnaitre = etape(rr);
if (!rr.ok) { console.log(`✗ non fait : ${rr.raison}`); nonFait.push(`la reconnaissance du projet n'a pas abouti : ${rr.raison}`); }
else console.log(`✓ ${carte?.cadre || '?'} · ${carte?.pages?.length ?? '?'} pages · ${carte?.tables?.length ?? '?'} tables`);

const BASE = (arg('--url', null) || `http://localhost:${carte?.port || 3000}`).replace(/\/$/, '');
R.url = BASE;

/* ══ 2-5. CÔTÉ CODE ════════════════════════════════════════════════════════ */

console.log(`\n  CÔTÉ CODE`);
const etapesCode = [
  ['câblage et désaccords', 'scan', 'scan.mjs', F('scan.json'), 15],
  ['liens logiques', 'lexical', 'lexical.mjs', F('lexical.json'), 15],
  ['fausses données (code)', 'fausses-donnees', 'fausses-donnees.mjs', F('fausses.json'), 15],
];
for (const [nom, cle, script, fichier, minutes] of etapesCode) {
  process.stdout.write(`    ${nom.padEnd(26)}`);
  const r = await lancer(script, [RACINE, '--json', fichier], minutes, fichier);
  R.etapes[cle] = etape(r);
  console.log(r.ok ? `✓${r.defauts ? ' (défauts trouvés)' : ''}` : `✗ non fait : ${r.raison}`);
  if (!r.ok) nonFait.push(`${nom} : non fait, ${r.raison}`);
}

process.stdout.write(`    ${'fausses données (base)'.padEnd(26)}`);
if (a('--sans-base')) {
  R.etapes['nettoyer-base'] = etape(null, '--sans-base');
  console.log(`✗ non fait : --sans-base`);
  nonFait.push(`la base n'a pas été inspectée (--sans-base) : les fausses données n'ont été cherchées que dans le code`);
} else {
  /* nettoyer-base exporte la base lui-même et sort en code 2 si l'export échoue :
     c'est exactement la condition « seulement si l'export réussit ». Et s'il sort en
     0 ou 1 sans avoir écrit fausses-en-base.json, ce n'est pas fait non plus.
     --export <zip|dossier> lui est transmis tel quel (pas de second export de la base). */
  const exp = arg('--export', null);
  const rb = await lancer('nettoyer-base.mjs', [RACINE, '--json', F('fausses-en-base.json'), ...(exp ? ['--export', exp] : [])],
    20, F('fausses-en-base.json'));
  R.etapes['nettoyer-base'] = etape(rb);
  console.log(rb.ok ? `✓${rb.defauts ? ' (suspects en base)' : ''}` : `✗ non fait : ${rb.raison}`);
  if (!rb.ok) nonFait.push(`la base n'a pas été inspectée : ${rb.raison}`);
}

/* ══ 6. CÔTÉ ÉCRAN, un travailleur par écran ═══════════════════════════════ */

const mods = modules();
const testables = mods.filter((m) => !m.dynamique);
console.log(`\n  CÔTÉ ÉCRAN : ${mods.length} pages trouvées, ${testables.length} testables sans identifiant, ${PARALLELES} travailleur(s)`);

// Les résultats d'un run précédent ne doivent pas se faire passer pour ceux-ci.
for (const f of fs.readdirSync(SORTIE)) if (/^(clics_|apparence_).*\.json$|^liens\.json$/.test(f)) fs.unlinkSync(F(f));
fs.mkdirSync(F('ecrans'), { recursive: true });

// L'application répond-elle ? Sans ça, tout le reste est un faux « tout va bien ».
let vivante = false;
try {
  const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', BASE], { encoding: 'utf8', timeout: 20000 }).trim();
  vivante = code !== '000';
} catch { /* non */ }

if (!vivante) {
  console.log(`\n  ⛔ ${BASE} ne répond pas. Lance l'application, sinon la moitié du travail`);
  console.log(`     est impossible et le rapport dirait « rien à signaler » à tort.`);
  nonFait.push(`l'application ne répondait pas sur ${BASE} : AUCUN écran n'a été testé`);
  R.etapes.liens = etape(null, `application éteinte sur ${BASE}`);
  R.etapes.ecrans = etape(null, `application éteinte sur ${BASE}`);
  for (const m of testables) R.ecrans.push({ route: m.route, statut: 'non fait : application éteinte', apparence_statut: 'non fait : application éteinte' });
} else {
  const ligne = (m, texte) => console.log(`    ${m.route.padEnd(30)}${texte}`);

  const tacheLiens = async () => {
    const rl = await lancer('liens.mjs', [BASE, '--depart', testables.map((m) => m.route).join(','),
      '--max', '300', '--json', F('liens.json')], 20, F('liens.json'));
    fs.writeFileSync(F('ecrans/liens.log'), rl.sortie + rl.erreur);
    const L = rl.ok ? lireJson(F('liens.json')) : null;
    R.etapes.liens = etape(rl);
    if (!rl.ok) nonFait.push(`les liens n'ont pas été suivis : ${rl.raison}`);
    else if (L?.non_verifies?.length) nonFait.push(`${L.non_verifies.length} liens non vérifiés (plafond --max 300 de liens.mjs)`);
    console.log(`    ${'liens (toute l\'app)'.padEnd(30)}${rl.ok ? `✓ ${L?.liens ?? '?'} liens, ${L?.verdicts?.length ?? 0} morts ou vides` : `✗ non fait : ${rl.raison}`}`);
    return L;
  };

  const tacheEcran = (m) => async () => {
    const url = BASE + m.route;
    const jc = F(`clics_${nomFichier(m.route)}.json`);
    const ja = F(`apparence_${nomFichier(m.route)}.json`);
    const rc = await lancer('clics.mjs', [url, '--max', a('--rapide') ? '40' : '400', '--json', jc], 15, jc);
    const ra = await lancer('apparence.mjs', [url, '--json', ja], 5, ja);
    fs.writeFileSync(F(`ecrans/${nomFichier(m.route)}.log`), rc.sortie + rc.erreur + '\n' + ra.sortie + ra.erreur);
    const c = rc.ok ? lireJson(jc) : null;
    const ap = ra.ok ? lireJson(ja) : null;
    const n = (v) => c?.verdicts?.filter((x) => x.verdict === v).length ?? 0;
    const e = {
      route: m.route,
      statut: c ? 'testé' : `non fait : ${rc.raison || 'aucun résultat écrit'}`,
      recenses: c?.recenses ?? 0, cliques: c?.cliques ?? 0,
      ecartes: c?.ecartes?.length ?? 0, non_cliques: c?.non_cliques?.length ?? 0, inclus: c?.inclus?.length ?? 0,
      erreurs: n('ERREUR'), casses: n('CASSÉ'), morts: n('MORT'), silencieux: n('SILENCIEUX'),
      apparence_statut: ap ? 'fait' : `non fait : ${ra.raison || 'aucun résultat écrit'}`,
      apparence: ap?.constats?.length ?? 0,
      ecartes_noms: (c?.ecartes || []).map((x) => ({ libelle: x.libelle, raison: x.raison })),
      non_cliques_noms: (c?.non_cliques || []).map((x) => ({ libelle: x.libelle, raison: x.raison })),
      duree_s: c?.duree_s ?? null,
    };
    if (!c) ligne(m, `✗ non fait : ${e.statut.replace(/^non fait : /, '')}`);
    else {
      const couverts = e.cliques + e.ecartes + e.non_cliques + e.inclus;
      const part = e.recenses ? Math.round(couverts / e.recenses * 100) : 100;
      ligne(m, `${String(e.cliques).padStart(4)}/${String(e.recenses).padEnd(4)} cliqués · ${String(part).padStart(3)} % couverts`
        + `${e.ecartes ? ` · ${e.ecartes} écartés` : ''}${e.non_cliques ? ` · ${e.non_cliques} non cliqués` : ''}`
        + `  ${e.erreurs ? `⛔${e.erreurs} ` : ''}${e.casses ? `💥${e.casses} ` : ''}${e.morts ? `∅${e.morts} ` : ''}`
        + `${ap ? (e.apparence ? `👁${e.apparence}` : '') : `👁 non fait : ${e.apparence_statut.replace(/^non fait : /, '')}`}`
        + `${e.duree_s ? `  ${e.duree_s} s` : ''}`);
    }
    return e;
  };

  const resultats = await enParallele([tacheLiens, ...testables.map(tacheEcran)], PARALLELES);
  for (const e of resultats.slice(1)) R.ecrans.push(e);
  const rates = R.ecrans.filter((e) => e.statut !== 'testé');
  R.etapes.ecrans = rates.length === R.ecrans.length && R.ecrans.length
    ? { statut: 'échec', raison: `aucun des ${R.ecrans.length} écrans n'a pu être testé`, code: 2 }
    : { statut: 'fait', raison: rates.length ? `${rates.length} écran(s) sur ${R.ecrans.length} non testés, nommés dans ecrans[]` : null, code: rates.length ? 2 : 0 };
}
for (const m of mods.filter((x) => x.dynamique)) {
  R.ecartes.push({ route: m.route, raison: 'segment dynamique : demande un identifiant réel' });
}

/* ══ 7. DÉCISIONS ═══════════════════════════════════════════════════════════ */

process.stdout.write(`\n  DÉCISIONS À TRANCHER      `);
const rd = await lancer('decisions.mjs', [RACINE], 10, F('questions.json'));
const questions = rd.ok ? lireJson(F('questions.json')) : null;
R.etapes.decisions = etape(rd);
if (!rd.ok) { console.log(`✗ non fait : ${rd.raison}`); nonFait.push(`les questions à l'humain n'ont pas été préparées : ${rd.raison}`); }
else console.log(`✓ ${Array.isArray(questions) ? questions.length : 0} question(s) pour l'humain`);

/* ══ LE TABLEAU ═════════════════════════════════════════════════════════════ */

const tot = (k) => R.ecrans.reduce((n, e) => n + (e[k] || 0), 0);
const testes = R.ecrans.filter((e) => e.statut === 'testé');
const nonTestes = R.ecrans.filter((e) => e.statut !== 'testé');
const apparenceNonFaite = R.ecrans.filter((e) => e.apparence_statut !== 'fait');
const liensJson = lireJson(F('liens.json'));
const liensMorts = liensJson?.verdicts?.length ?? 0;
const couverts = tot('cliques') + tot('ecartes') + tot('non_cliques') + tot('inclus');

console.log(`\n  ${'='.repeat(74)}`);
console.log(`  COUVERTURE`);
console.log(`    modules testés            ${testes.length} / ${mods.length}`);
console.log(`    boutons cliqués           ${tot('cliques')} / ${tot('recenses')}`
  + `   (${tot('recenses') ? Math.round(tot('cliques') / tot('recenses') * 100) : 0} %)`);
console.log(`    cliqués ou expliqués      ${couverts} / ${tot('recenses')}`
  + `   (${tot('recenses') ? Math.round(couverts / tot('recenses') * 100) : 0} %)`);
console.log(`    écartés volontairement    ${tot('ecartes')}   (écrivent ou détruisent : à tester par agent ou à la main)`);
console.log(`    non cliqués               ${tot('non_cliques')}   (voulus, pas atteints : ce n'est pas un OK)`);
if (tot('inclus')) console.log(`    inclus dans un parent     ${tot('inclus')}   (le parent a été testé)`);
if (R.ecartes.length) console.log(`    non testables sans donnée ${R.ecartes.length}   (${R.ecartes.map((x) => x.route).join(', ')})`);
console.log(`\n  CE QU'ON A TROUVÉ CÔTÉ ÉCRAN`);
console.log(`    erreurs au clic           ${tot('erreurs')}`);
console.log(`    écrans qui se cassent     ${tot('casses')}`);
console.log(`    boutons morts             ${tot('morts')}`);
console.log(`    plantages silencieux      ${tot('silencieux')}`);
console.log(`    liens morts ou vides      ${liensMorts}`);
console.log(`    défauts d'apparence       ${tot('apparence')}${apparenceNonFaite.length ? `   (sur ${R.ecrans.length - apparenceNonFaite.length} écrans contrôlés)` : ''}`);

const avecEcartes = testes.filter((e) => e.ecartes_noms.length);
if (avecEcartes.length) {
  console.log(`\n  ÉCARTÉS, NOMMÉMENT : à tester par un agent avec consentement, ou à la main`);
  for (const e of avecEcartes) {
    console.log(`    ${e.route}`);
    for (const x of e.ecartes_noms.slice(0, 15)) console.log(`      « ${x.libelle} »  ${x.raison}`);
    if (e.ecartes_noms.length > 15) console.log(`      … et ${e.ecartes_noms.length - 15} autres`);
  }
}
const avecNonCliques = testes.filter((e) => e.non_cliques_noms.length);
if (avecNonCliques.length) {
  console.log(`\n  NON CLIQUÉS, NOMMÉMENT : voulus, pas atteints`);
  for (const e of avecNonCliques) {
    console.log(`    ${e.route}`);
    for (const x of e.non_cliques_noms.slice(0, 10)) console.log(`      « ${x.libelle} »  ${x.raison}`);
    if (e.non_cliques_noms.length > 10) console.log(`      … et ${e.non_cliques_noms.length - 10} autres`);
  }
}
if (nonTestes.length) {
  console.log(`\n  ⚠️  ÉCRANS NON TESTÉS, et il faut le savoir :`);
  for (const e of nonTestes) console.log(`    ${e.route}  ${e.statut}`);
}
if (apparenceNonFaite.length && vivante) {
  console.log(`\n  ⚠️  APPARENCE NON CONTRÔLÉE :`);
  for (const e of apparenceNonFaite) console.log(`    ${e.route}  ${e.apparence_statut}`);
}

/* ══ LA LOI ANTI-PARESSE ════════════════════════════════════════════════════
   Une règle écrite ne tient pas. Un mécanisme tient. Ici, le travail incomplet ne
   peut pas se faire passer pour du travail fini : il sort en code 2, et le rapport
   nomme chaque raccourci pris, chaque enfant qui n'a pas abouti, chaque bouton
   voulu et pas atteint. Ce qui est ÉCARTÉ exprès n'est pas un raccourci : c'est une
   décision, nommée plus haut, et le bilan la reprend telle quelle. */

if (a('--rapide')) nonFait.push('--rapide : au plus 40 boutons par écran au lieu de tous');
if (nonTestes.length && vivante) nonFait.push(`${nonTestes.length} écran(s) non testés : ${nonTestes.map((e) => `${e.route} (${e.statut.replace(/^non fait : /, '')})`).join(' ; ')}`);
if (apparenceNonFaite.length && vivante) nonFait.push(`apparence non contrôlée sur ${apparenceNonFaite.length} écran(s) : ${apparenceNonFaite.map((e) => e.route).join(', ')}`);
if (tot('non_cliques')) nonFait.push(`${tot('non_cliques')} bouton(s) voulus et pas atteints (détail nommé ci-dessus)`);
if (R.ecartes.length) nonFait.push(`${R.ecartes.length} page(s) à identifiant dynamique : fournir un identifiant réel pour les couvrir`);

R.complet = nonFait.length === 0;
R.raccourcis = nonFait;
R.totaux = { recenses: tot('recenses'), cliques: tot('cliques'), ecartes: tot('ecartes'), non_cliques: tot('non_cliques'), inclus: tot('inclus'),
  erreurs: tot('erreurs'), casses: tot('casses'), morts: tot('morts'), silencieux: tot('silencieux'), apparence: tot('apparence'), liens_morts: liensMorts };

// bilan.mjs lit couverture.json (ses raccourcis) : on l'écrit AVANT de le lancer.
const ecrire = () => {
  ecrireJson(RACINE, 'couverture.json', R);
  if (arg('--json', null)) ecrireJson(RACINE, 'couverture.json', R, arg('--json'));
};
ecrire();

/* ══ 8. BILAN ═══════════════════════════════════════════════════════════════ */

process.stdout.write(`\n  BILAN                     `);
const rbi = await lancer('bilan.mjs', [RACINE, '--md', F('BILAN.md')], 10);
// bilan sort 2 quand il reste du « non couvert » : c'est un verdict, pas une panne. Il est fait s'il a écrit BILAN.md.
const bilanEcrit = fs.existsSync(F('BILAN.md')) && rbi.code !== null && !rbi.signal;
R.etapes.bilan = bilanEcrit ? { statut: 'fait', raison: rbi.code === 2 ? 'niveau INCONNU : du non couvert subsiste' : null, code: rbi.code }
  : { statut: 'échec', raison: rbi.raison, code: rbi.code };
if (!bilanEcrit) { console.log(`✗ non fait : ${rbi.raison}`); nonFait.push(`le bilan n'a pas été écrit : ${rbi.raison}`); R.complet = false; R.raccourcis = nonFait; }
else {
  const niveau = (rbi.sortie.match(/(⬛|🟥|🟧|🟩)[^\n]*/) || [rbi.code === 2 ? 'INCONNU' : `code ${rbi.code}`])[0].trim();
  console.log(`✓ ${niveau.slice(0, 70)}  → ${F('BILAN.md')}`);
}
ecrire();

console.log(`\n  Détail : ${SORTIE}/   (écrans/ : la sortie brute de chaque travailleur)`);
console.log(`  Durée : ${Math.round((Date.now() - T0) / 1000)} s\n`);

if (nonFait.length) {
  console.log(`  ${'='.repeat(74)}`);
  console.log(`  ⛔ TRAVAIL INCOMPLET : ce rapport ne prouve rien sur les points suivants :\n`);
  for (const r of nonFait) console.log(`     · ${r}`);
  console.log(`\n  Relancer sans raccourci, application allumée, jusqu'à ce que cette section`);
  console.log(`  disparaisse. Un audit partiel présenté comme complet est pire qu'aucun audit :`);
  console.log(`  il fait croire que ce qui n'a pas été regardé est propre.\n`);
} else {
  console.log(`  ${'='.repeat(74)}`);
  console.log(`  ✓ COUVERTURE COMPLÈTE : tous les modules, tous les boutons cliquables ou nommés.\n`);
}

// 2 = incomplet (on ne sait pas), 1 = complet avec des défauts, 0 = complet et propre.
process.exitCode = nonFait.length ? 2 : (tot('erreurs') + tot('casses') + liensMorts ? 1 : 0);

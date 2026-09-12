#!/usr/bin/env node
/**
 * mesurer.mjs — LA commande. Une seule, reproductible, qui sort les deux chiffres.
 *
 *   node mesurer.mjs                   → banc figé + banc génératif (graine du jour)
 *   node mesurer.mjs --fige            → banc figé seul (quelques secondes)
 *   node mesurer.mjs --graine=4242     → banc génératif reproductible
 *   node mesurer.mjs --enregistre      → écrit au journal, pour le cliquet
 *   node mesurer.mjs --json            → sortie machine
 *
 * LES DEUX MOTS, qui ne veulent pas dire la même chose :
 *   RAPPEL   = part des défauts CONNUS que l'auditeur signale.      (il voit ?)
 *   JUSTESSE = part de ce qu'il signale qui est vrai.               (il dit vrai ?)
 *
 * DEUX RÉGIMES, jamais mélangés :
 *   — banc figé, vérité exhaustive et arbitrage écrit → justesse absolue ;
 *   — banc génératif sur code réel → JUSTESSE DIFFÉRENTIELLE : on ne note que les
 *     signalements APPARUS entre le dépôt sain et le dépôt muté. Le fond de bruit du projet
 *     (2 031 signalements sur projet client C) est retranché des deux côtés : il ne peut ni gonfler
 *     le rappel ni plomber la justesse.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { apparierAudit, apparie as apparierItem } from './lib/appariement.mjs';
import { wilson, ligneIC, tailleRequise } from './lib/stats.mjs';
import { familleDeRegle, FAMILLES, famillesNonCouvertes } from './familles.mjs';
import { genererLot } from './generer-banc.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const AUDITEUR = process.env.AUDITEUR || path.resolve(ICI, '..', '..', 'scripts', 'audit-backend.mjs');
const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=')[1] : d; };
const A = (n) => process.argv.includes('--' + n);
const GRAINE = Number(ARG('graine', Date.now() % 100000));
const N_MUTATIONS = Number(ARG('mutations', 40));

function auditer(repo) {
  const t0 = Date.now();
  let brut;
  try {
    brut = execFileSync('node', [AUDITEUR, repo, '--json', '--full'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 });
  } catch (e) {
    if (e.stdout) brut = e.stdout;           // code 1 = défaut bloquant, c'est normal
    else return { findings: [], erreur: String(e.message).slice(0, 160), ms: Date.now() - t0 };
  }
  try { return { ...JSON.parse(brut), ms: Date.now() - t0 }; }
  catch { return { findings: [], erreur: 'sortie JSON illisible', ms: Date.now() - t0 }; }
}

const sceau = (o) => crypto.createHash('sha256').update(JSON.stringify(o.defauts)).digest('hex').slice(0, 16);

function chargerVerdicts(cas) {
  const p = path.join(ICI, 'verdicts', cas + '.json');
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')).verdicts || []) : [];
}

function evaluerFige(verite, repo) {
  const audit = auditer(repo);
  const { parDefaut, parItem } = apparierAudit(audit.findings || [], verite, familleDeRegle);
  const trouves = {
    localisation: parDefaut.filter((d) => d.trouve.some((t) => t.localisation)).length,
    precis: parDefaut.filter((d) => d.trouve.some((t) => t.precis)).length,
    diagnostic: parDefaut.filter((d) => d.trouve.some((t) => t.diagnostic)).length,
  };

  /* Justesse, trois seaux jamais mélangés :
   *   VRAI = apparié à un défaut listé, OU arbitré « vrai » avec preuve.
   *   FAUX = arbitré « faux » avec preuve.
   *   NON ARBITRÉ = ni l'un ni l'autre, compté À PART, JAMAIS en faux.
   * Le troisième seau est la dette honnête du banc. C'est l'erreur qui faisait dire
   * « 50 % de justesse » sur un dépôt où 7 des 9 « faux positifs » étaient des défauts
   * RÉELS, simplement hors des cas plantés. */
  const arb = chargerVerdicts(verite.cas);
  let vrais = 0, faux = 0, hors = 0, nonArbitres = 0;
  const fauxDetail = [], aArbitrer = [];
  for (const it of parItem) {
    const v = arb.find((a) => a.regle === it.regle && it.texte.includes(a.motif));
    if (v && v.verdict === 'faux') { faux++; fauxDetail.push(`${it.regle}  ${it.texte.slice(0, 88)}  ← ${v.preuve.slice(0, 64)}`); }
    else if (v && v.verdict === 'hors') hors++;
    else if (v && v.verdict === 'vrai') vrais++;
    else if (it.touche.some((t) => t.precis)) vrais++;
    else { nonArbitres++; aArbitrer.push(`${it.regle}  ${it.texte.slice(0, 96)}`); }
  }
  return { cas: verite.cas, sceau: sceau(verite), ms: audit.ms, nDefauts: verite.defauts.length,
    trouves, parDefaut, nItems: parItem.length, vrais, faux, hors, nonArbitres, fauxDetail, aArbitrer };
}

function evaluerPlanche(planche, cacheBase) {
  const base = cacheBase[planche.repoSain] || (cacheBase[planche.repoSain] = auditer(planche.repoSain));
  const mute = auditer(planche.repoMute);
  const cle = (id, i) => id + '␟' + i;
  const avant = new Set((base.findings || []).flatMap((f) => f.items.map((i) => cle(f.id, i))));
  const nouveaux = [];
  for (const f of mute.findings || []) for (const i of f.items)
    if (!avant.has(cle(f.id, i))) nouveaux.push({ regle: f.id, texte: i });

  const liens = nouveaux.map((n) => ({ ...n,
    touche: planche.defauts.map((d) => ({ d, ...apparierItem(n.texte, d) })).filter((x) => x.localisation) }));

  const resultats = planche.defauts.map((d) => {
    const vus = liens.filter((l) => l.touche.some((t) => t.d.id === d.id && t.precis));
    const vusLoc = liens.filter((l) => l.touche.some((t) => t.d.id === d.id));
    return { cas: `${d.origine}/${d.operateur}/${d.id}`, famille: d.familles[0], operateur: d.operateur,
      repo: d.origine, trouve: vus.length > 0, trouveLoc: vusLoc.length > 0,
      diag: vus.some((v) => d.familles.includes(familleDeRegle(v.regle))),
      regles: [...new Set(vus.map((v) => v.regle))], defaut: d };
  });

  return { resultats,
    vrais: liens.filter((l) => l.touche.some((t) => t.precis)).length,
    faux: liens.filter((l) => l.touche.length === 0).length,
    ms: base.ms + mute.ms, nNouveaux: nouveaux.length,
    nBase: (base.findings || []).reduce((s, f) => s + f.items.length, 0),
    fauxDetail: liens.filter((l) => l.touche.length === 0).map((l) => `${l.regle}  ${l.texte.slice(0, 92)}`),
    planche: `${planche.nom} (${planche.defauts.length} défauts plantés)` };
}

/* ───────────────────────────────── Programme ────────────────────────────── */

const R = { figes: [], mutations: [], planches: [], meta: { date: new Date().toISOString(), graine: GRAINE, auditeur: AUDITEUR } };

for (const f of fs.readdirSync(path.join(ICI, 'verite')).filter((x) => x.endsWith('.json')).sort()) {
  const v = JSON.parse(fs.readFileSync(path.join(ICI, 'verite', f), 'utf8'));
  if (v.archive) continue;                       // vérité conservée mais dépôt disparu
  const repo = path.resolve(path.join(ICI, 'verite'), v.repo);
  if (!fs.existsSync(repo)) { console.error(`  (cas ignoré, dépôt absent : ${v.cas} → ${repo})`); continue; }
  R.figes.push(evaluerFige(v, repo));
}

if (!A('fige')) {
  const lot = genererLot({ graine: GRAINE, n: N_MUTATIONS });
  R.meta.lot = lot.meta;
  const cache = {};
  for (const p of lot.planches) {
    const r = evaluerPlanche(p, cache);
    R.planches.push({ planche: r.planche, vrais: r.vrais, faux: r.faux, nBase: r.nBase, nNouveaux: r.nNouveaux, ms: r.ms, fauxDetail: r.fauxDetail });
    R.mutations.push(...r.resultats);
  }
  lot.nettoyer();
}

const agr = (l, f) => l.reduce((s, x) => s + f(x), 0);
const figeDef = agr(R.figes, (c) => c.nDefauts);
const figeLoc = agr(R.figes, (c) => c.trouves.localisation);
const figePre = agr(R.figes, (c) => c.trouves.precis);
const figeDia = agr(R.figes, (c) => c.trouves.diagnostic);
const figeVrais = agr(R.figes, (c) => c.vrais), figeFaux = agr(R.figes, (c) => c.faux);
const figeNA = agr(R.figes, (c) => c.nonArbitres);
const mutN = R.mutations.length;
const mutDiag = R.mutations.filter((m) => m.diag).length;
const mutPre = R.mutations.filter((m) => m.trouve).length;
const mutLoc = R.mutations.filter((m) => m.trouveLoc).length;
const mutVrais = agr(R.planches, (p) => p.vrais), mutFaux = agr(R.planches, (p) => p.faux);

if (A('json')) {
  console.log(JSON.stringify(R, null, 2));
} else {
  const B = '─'.repeat(78);
  console.log(`\n${B}\n MESURE DU SKILL BACKEND   ${R.meta.date.slice(0, 16).replace('T', ' ')}   graine ${GRAINE}\n${B}`);
  console.log(`\n▸ LES DEUX CHIFFRES                       valeur      IC 95 %             brut`);
  console.log('  ' + ligneIC('RAPPEL (vu ET diagnostiqué)', figeDia + mutDiag, figeDef + mutN));
  console.log('  ' + ligneIC('JUSTESSE (signalement arbitré vrai)', figeVrais + mutVrais, figeVrais + figeFaux + mutVrais + mutFaux));
  if (figeNA) console.log(`     ⚠ ${figeNA} signalement(s) sans arbitrage : hors du calcul, dette visible.`);

  console.log(`\n▸ RAPPEL, TROIS NIVEAUX  (l'écart mesure la générosité de l'appariement)`);
  console.log('  ' + ligneIC('1. a nommé le bon fichier', figeLoc + mutLoc, figeDef + mutN));
  console.log('  ' + ligneIC('2. + le bon symbole ou la bonne ligne', figePre + mutPre, figeDef + mutN));
  console.log('  ' + ligneIC('3. + la bonne famille  ← LE CHIFFRE', figeDia + mutDiag, figeDef + mutN));

  for (const c of R.figes)
    console.log(`\n▸ BANC FIGÉ « ${c.cas} »   ${c.trouves.diagnostic}/${c.nDefauts} défauts diagnostiqués` +
      `   ${c.vrais}/${c.nItems} signalements vrais (${c.faux} faux, ${c.hors} hors sujet, ${c.nonArbitres} non arbitrés)` +
      `   sceau ${c.sceau}  ${(c.ms / 1000).toFixed(1)}s`);

  if (mutN) {
    console.log(`\n▸ BANC GÉNÉRATIF (${mutN} mutations tirées sur du code réel, graine ${GRAINE})`);
    console.log('  ' + ligneIC('  rappel diagnostic', mutDiag, mutN));
    console.log('  ' + ligneIC('  rappel localisation (borne haute)', mutLoc, mutN));
    console.log('  ' + ligneIC('  justesse différentielle', mutVrais, mutVrais + mutFaux));
    const pf = {};
    for (const m of R.mutations) { (pf[m.famille] ||= { n: 0, ok: 0 }).n++; if (m.diag) pf[m.famille].ok++; }
    console.log(`\n  par famille :`);
    for (const [f, v] of Object.entries(pf).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n))
      console.log('    ' + ligneIC(f, v.ok, v.n));
    for (const p of R.planches) console.log(`\n  ${p.planche} : ${p.nBase} signalements au repos, ${p.nNouveaux} nouveaux, ${(p.ms / 1000 / 60).toFixed(1)} min`);
  }

  const fam = {};
  for (const c of R.figes) for (const d of c.parDefaut) {
    const f = d.defaut.familles[0];
    (fam[f] ||= { n: 0, ok: 0 }).n++;
    if (d.trouve.some((t) => t.diagnostic)) fam[f].ok++;
  }
  for (const m of R.mutations) { (fam[m.famille] ||= { n: 0, ok: 0 }).n++; if (m.diag) fam[m.famille].ok++; }
  const zeros = Object.entries(fam).filter(([, v]) => v.ok === 0).map(([f]) => f);
  console.log(`\n▸ FAMILLES OÙ IL NE VOIT RIEN (${zeros.length}/${Object.keys(fam).length} testées)`);
  console.log('  ' + (zeros.length ? zeros.join(', ') : 'aucune'));
  const nc = famillesNonCouvertes();
  console.log(`\n▸ FAMILLES QU'AUCUNE RÈGLE NE PRÉTEND COUVRIR (${nc.length}/${Object.keys(FAMILLES).length})`);
  console.log('  ' + nc.join(', '));

  const nTot = figeDef + mutN;
  console.log(`\n▸ CE QUE VAUT CE CHIFFRE`);
  console.log(`  ${nTot} cas. Pour un intervalle de ±10 points autour de 50 %, il en faudrait ${tailleRequise(0.5, 0.2)} ;`);
  console.log(`  autour de 20 %, ${tailleRequise(0.2, 0.2)}. Autour de 10 %, ${tailleRequise(0.1, 0.2)}.`);
  for (const c of R.figes) if (c.fauxDetail.length) {
    console.log(`\n▸ FAUX SIGNALEMENTS (${c.cas})`);
    for (const l of c.fauxDetail.slice(0, 10)) console.log('    ' + l);
  }
  for (const c of R.figes) if (c.aArbitrer.length) {
    console.log(`\n▸ EN ATTENTE D'ARBITRAGE (${c.cas}, non comptés)`);
    for (const l of c.aArbitrer.slice(0, 15)) console.log('    ' + l);
  }
  const fm = R.planches.flatMap((p) => p.fauxDetail);
  if (fm.length) {
    console.log(`\n▸ APPARUS AVEC LA MUTATION ET SANS RAPPORT AVEC ELLE (${fm.length})`);
    for (const l of fm.slice(0, 12)) console.log('    ' + l);
  }
  console.log('');
}

if (A('enregistre')) {
  const empreinte = () => {
    const d = path.dirname(AUDITEUR); const h = crypto.createHash('sha256');
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.mjs')).sort()) h.update(f).update(fs.readFileSync(path.join(d, f)));
    return h.digest('hex').slice(0, 16);
  };
  const ligne = { date: R.meta.date, graine: GRAINE,
    rappel: { s: figeDia + mutDiag, n: figeDef + mutN },
    rappel_localisation: { s: figeLoc + mutLoc, n: figeDef + mutN },
    justesse: { s: figeVrais + mutVrais, n: figeVrais + figeFaux + mutVrais + mutFaux },
    rappel_fige: { s: figeDia, n: figeDef }, justesse_fige: { s: figeVrais, n: figeVrais + figeFaux },
    sceaux: Object.fromEntries(R.figes.map((c) => [c.cas, c.sceau])), auditeur_sha: empreinte() };
  fs.appendFileSync(path.join(ICI, 'journal', 'mesures.jsonl'), JSON.stringify(ligne) + '\n');
  console.log(`  ↳ enregistré au journal\n`);
}

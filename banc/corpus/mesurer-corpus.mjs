#!/usr/bin/env node
/**
 * mesurer-corpus.mjs — Passer l'auditeur sur des défauts que personne n'a inventés pour lui.
 *
 * Pour chaque cas du corpus :
 *   1. on remet le dépôt dans l'état AVANT le correctif (checkout du commit parent, dans un
 *      clone, jamais dans le dépôt d'origine) ;
 *   2. on lance scripts/audit-backend.mjs --json --full ;
 *   3. on regarde s'il parle à l'endroit que le correctif humain a touché.
 *
 * QUATRE NIVEAUX, les trois premiers sont ceux du harnais figé (banc/mesure/lib/appariement.mjs,
 * réutilisé tel quel pour que les chiffres soient comparables) :
 *   LOCALISATION : un signalement nomme le fichier fautif.
 *   PRÉCIS       : + le symbole touché, ou une ligne à ±12 de la ligne corrigée.
 *   DIAGNOSTIC   : + la famille de la règle qui parle est celle du défaut.
 *   DISPARITION  : le signalement précis n'est plus là APRÈS le correctif humain.
 *
 * Le quatrième est celui qu'aucun banc maison n'attrape : un détecteur qui crie sur tout
 * obtient un rappel parfait et échoue ici, parce que le correctif ne le fait pas taire.
 *
 *   node mesurer-corpus.mjs --echantillon=50 --graine=20260912   (tirage reproductible)
 *   node mesurer-corpus.mjs --tout [--part=1/6]                  (tout, ou une part pour paralléliser)
 *   node mesurer-corpus.mjs --bilan [--echantillon=50 --graine=20260912]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { apparie } from '../mesure/lib/appariement.mjs';
import { wilson, ligneIC } from '../mesure/lib/stats.mjs';
import { familleDeRegle, FAMILLES } from '../mesure/familles.mjs';
import { DEPOTS } from './moissonner-corpus.mjs';
import { TRAVAIL, CLONES } from './atelier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(ICI, '..', '..');
const AUDITEUR = process.env.AUDITEUR || path.join(RACINE, 'scripts', 'audit-backend.mjs');
const CAS = path.join(ICI, 'cas');
const MESURES = path.join(TRAVAIL, 'mesures');
const WT = path.join(TRAVAIL, 'wt');

const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=')[1] : d; };
const A = (n) => process.argv.includes('--' + n);
const GRAINE = Number(ARG('graine', 20260912));
const N_ECH = Number(ARG('echantillon', 0));

/* ── tirage reproductible ─────────────────────────────────────────────────── */
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function chargerCas() {
  return fs.readdirSync(CAS).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(CAS, f), 'utf8')));
}

export function echantillon(tous, n, graine) {
  const r = mulberry32(graine);
  const a = [...tous];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n).sort((x, y) => x.id.localeCompare(y.id));
}

/* ── mesure d'un cas ──────────────────────────────────────────────────────── */
const clone = (nom) => DEPOTS.find((d) => d.nom === nom).clone;

function racineProjet(wt, fichiers) {
  const segs = fichiers[0].split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    const d = path.join(wt, ...segs.slice(0, i));
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
  }
  return wt;
}

function poser(depot, sha, dossier) {
  fs.rmSync(dossier, { recursive: true, force: true });
  execFileSync('git', ['-C', clone(depot), 'worktree', 'add', '--detach', '-f', dossier, sha],
    { encoding: 'utf8', stdio: 'pipe' });
}
function retirer(depot, dossier) {
  try { execFileSync('git', ['-C', clone(depot), 'worktree', 'remove', '--force', dossier], { stdio: 'pipe' }); }
  catch { fs.rmSync(dossier, { recursive: true, force: true }); }
}

function auditer(racine) {
  const t0 = Date.now();
  let brut;
  try {
    brut = execFileSync('node', [AUDITEUR, racine, '--json', '--full'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 });
  } catch (e) {
    if (e.stdout) brut = e.stdout;
    else return { findings: [], erreur: String(e.message).slice(0, 120), ms: Date.now() - t0 };
  }
  try { return { ...JSON.parse(brut), ms: Date.now() - t0 }; }
  catch { return { findings: [], erreur: 'JSON illisible', ms: Date.now() - t0 }; }
}

/* Les symboles viennent des en-têtes de diff : on y récolte aussi des mots sans pouvoir
 * discriminant (`string`, `undefined`, `Promise`). Un signalement qui nomme le bon fichier ET
 * contient le mot « string » serait compté « précis ». La mesure publiée du 12/09/2026 a été
 * faite SANS ce filtre (66,4 %) ; avec, elle tombe à 54,3 %. Le filtre est donc optionnel, pour
 * que l'ancienne mesure reste reproductible : --symboles-stricts. */
const SYMBOLES_VIDES = new Set(['string', 'undefined', 'number', 'boolean', 'Promise', 'Record',
  'Array', 'object', 'never', 'unknown', 'false', 'true', 'null', 'value', 'args', 'query',
  'mutation', 'action', 'internal']);

/** L'ancre du défaut, au format attendu par banc/mesure/lib/appariement.mjs. */
function ancre(c) {
  const stricts = process.argv.includes('--symboles-stricts');
  return {
    id: c.id,
    familles: [c.famille, ...(c.familles_secondaires || [])],
    fichiers: c.fichiers,
    lignes: Object.values(c.lignes_avant || {}).flat(),
    symboles: Object.values(c.symboles || {}).flat()
      .filter((s) => s.length >= 5 && !(stricts && SYMBOLES_VIDES.has(s))),
  };
}

function confronter(audit, c) {
  const d = ancre(c);
  const touches = [];
  for (const f of audit.findings || []) for (const it of f.items) {
    const r = apparie(it, d);
    if (!r.localisation) continue;
    const fam = familleDeRegle(f.id);
    touches.push({ regle: f.id, axe: f.axe, texte: String(it).slice(0, 200), ...r, famille: fam,
      diagnostic: r.precis && fam && d.familles.includes(fam) });
  }
  return touches;
}

export function mesurerCas(c, { disparition = true } = {}) {
  const t0 = Date.now();
  const dCasse = path.join(WT, c.id + '-casse');
  const dRepare = path.join(WT, c.id + '-repare');
  const out = { id: c.id, depot: c.depot, famille: c.famille };
  try {
    poser(c.depot, c.commit_casse, dCasse);
    const racine = racineProjet(dCasse, c.fichiers);
    const audit = auditer(racine);
    out.erreur = audit.erreur || null;
    out.nItems = (audit.findings || []).reduce((s, f) => s + f.items.length, 0);
    const touches = confronter(audit, c);
    out.localisation = touches.length > 0;
    out.precis = touches.some((t) => t.precis);
    out.diagnostic = touches.some((t) => t.diagnostic);
    out.regles = [...new Set(touches.filter((t) => t.precis).map((t) => t.regle))];
    out.reglesLoc = [...new Set(touches.map((t) => t.regle))];
    out.extraits = touches.filter((t) => t.precis).slice(0, 3).map((t) => `${t.regle}  ${t.texte.slice(0, 120)}`);
    retirer(c.depot, dCasse);

    if (disparition && out.precis) {
      poser(c.depot, c.commit_repare, dRepare);
      const audit2 = auditer(racineProjet(dRepare, c.fichiers));
      const t2 = confronter(audit2, c);
      const avant = new Set(touches.filter((t) => t.precis).map((t) => t.regle + '␟' + t.texte));
      const apres = new Set(t2.filter((t) => t.precis).map((t) => t.regle + '␟' + t.texte));
      out.disparition = [...avant].some((x) => !apres.has(x));
      out.nApres = apres.size;

      /* PIÈGE, et il fausse la disparition dans le sens flatteur : le texte d'un signalement
       * contient « fichier.ts:214 ». Le correctif humain déplace les lignes du fichier, donc
       * le MÊME signalement ressort avec un autre numéro et compte comme « disparu ». On
       * recompte donc en neutralisant les numéros de ligne : c'est le chiffre sévère. */
      const neutre = (s) => s.replace(/:\d+/g, ':#');
      const avantN = new Set([...avant].map(neutre));
      const apresN = new Set([...apres].map(neutre));
      out.disparition_stricte = [...avantN].some((x) => !apresN.has(x));
      retirer(c.depot, dRepare);
    } else out.disparition = null;
  } catch (e) {
    out.erreur = String(e.message).slice(0, 200);
    try { retirer(c.depot, dCasse); retirer(c.depot, dRepare); } catch {}
  }
  out.ms = Date.now() - t0;
  return out;
}

/* ── bilan ────────────────────────────────────────────────────────────────── */
function lireMesures(ids) {
  const out = [];
  for (const id of ids) {
    const p = path.join(MESURES, id + '.json');
    if (fs.existsSync(p)) out.push(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return out;
}

function bilan(cas, titre) {
  const m = lireMesures(cas.map((c) => c.id));
  const fait = m.filter((x) => !x.erreur || x.nItems);
  console.log(`\n${titre}`);
  console.log(`  cas mesurés : ${m.length}/${cas.length}${m.length !== fait.length ? `  (${m.length - fait.length} en erreur d'audit)` : ''}`);
  console.log('');
  console.log('  ' + ligneIC('LOCALISATION (bon fichier)', m.filter((x) => x.localisation).length, m.length));
  console.log('  ' + ligneIC('PRÉCIS (bonne ligne/symbole)', m.filter((x) => x.precis).length, m.length));
  console.log('  ' + ligneIC('DIAGNOSTIC (bonne famille)', m.filter((x) => x.diagnostic).length, m.length));
  const avecD = m.filter((x) => x.disparition !== null && x.disparition !== undefined);
  console.log('  ' + ligneIC('DISPARITION après correctif', avecD.filter((x) => x.disparition).length, avecD.length));
  const avecS = m.filter((x) => x.disparition_stricte !== undefined && x.disparition_stricte !== null);
  if (avecS.length) console.log('  ' + ligneIC('DISPARITION, lignes neutralisées', avecS.filter((x) => x.disparition_stricte).length, avecS.length));

  const fam = {};
  for (const x of m) {
    const f = (fam[x.famille] = fam[x.famille] || { n: 0, loc: 0, pre: 0, diag: 0 });
    f.n++; if (x.localisation) f.loc++; if (x.precis) f.pre++; if (x.diagnostic) f.diag++;
  }
  console.log('\n  PAR FAMILLE (n, localisation, précis, diagnostic)');
  for (const [f, v] of Object.entries(fam).sort((a, b) => b[1].n - a[1].n))
    console.log(`   ${String(v.n).padStart(3)}  ${f.padEnd(20)} loc ${String(v.loc).padStart(3)}   pre ${String(v.pre).padStart(3)}   diag ${String(v.diag).padStart(3)}   ${Object.prototype.hasOwnProperty.call(FAMILLES, f) ? '' : '(hors taxonomie)'}`);

  const regles = {};
  for (const x of m) for (const r of x.regles || []) regles[r] = (regles[r] || 0) + 1;
  console.log('\n  RÈGLES QUI ONT TOUCHÉ UN DÉFAUT RÉEL (précis)');
  console.log('   ' + (Object.entries(regles).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}:${n}`).join('  ') || 'aucune'));
  return { m, fam, regles, w: { loc: wilson(m.filter((x) => x.localisation).length, m.length), pre: wilson(m.filter((x) => x.precis).length, m.length), diag: wilson(m.filter((x) => x.diagnostic).length, m.length) } };
}

/* ── entrée ───────────────────────────────────────────────────────────────── */
if (import.meta.url === `file://${process.argv[1]}`) {
  const tous = chargerCas();
  let liste = N_ECH ? echantillon(tous, N_ECH, GRAINE) : tous;
  if (A('bilan')) {
    const r = bilan(liste, N_ECH ? `BILAN — échantillon de ${N_ECH} cas, graine ${GRAINE}` : `BILAN — corpus entier (${tous.length} cas)`);
    if (A('json')) fs.writeFileSync(path.join(ICI, 'resultats.json'), JSON.stringify({ graine: GRAINE, n: liste.length, ...r }, null, 2));
    process.exit(0);
  }
  const fListe = ARG('liste', null);          // un JSON qui contient un tableau d'identifiants
  if (fListe) {
    const ids = new Set(JSON.parse(fs.readFileSync(fListe, 'utf8')));
    liste = tous.filter((c) => ids.has(c.id));
  }
  const part = ARG('part', null);
  if (part) {
    const [i, n] = part.split('/').map(Number);
    liste = liste.filter((_, k) => k % n === i - 1);
  }
  fs.mkdirSync(MESURES, { recursive: true });
  fs.mkdirSync(WT, { recursive: true });
  if (N_ECH) fs.writeFileSync(path.join(ICI, `echantillon-${GRAINE}.json`), JSON.stringify({ graine: GRAINE, n: N_ECH, ids: echantillon(tous, N_ECH, GRAINE).map((c) => c.id) }, null, 2));
  let k = 0;
  for (const c of liste) {
    k++;
    const p = path.join(MESURES, c.id + '.json');
    if (fs.existsSync(p) && !A('refaire')) { console.log(`  ${k}/${liste.length} ${c.id} — déjà mesuré`); continue; }
    const r = mesurerCas(c, { disparition: !A('sans-disparition') });
    fs.writeFileSync(p, JSON.stringify(r, null, 2));
    console.log(`  ${k}/${liste.length} ${c.id.padEnd(22)} ${r.erreur ? 'ERREUR ' + r.erreur : `loc=${r.localisation ? 1 : 0} pre=${r.precis ? 1 : 0} diag=${r.diagnostic ? 1 : 0} disp=${r.disparition === null ? '-' : r.disparition ? 1 : 0}`}  ${(r.ms / 1000).toFixed(0)}s`);
  }
}

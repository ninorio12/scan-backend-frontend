#!/usr/bin/env node
/**
 * temoin-corpus.mjs — Combien vaut « il a nommé le bon fichier » quand l'auditeur sort
 * 1 400 signalements sur un dépôt de 600 fichiers ?
 *
 * Sans ce témoin, le taux de LOCALISATION du corpus n'est pas interprétable : un auditeur
 * qui parle de la moitié des fichiers du projet « localise » la moitié des défauts par
 * hasard. On tire donc des ancres PLACEBO — un fichier backend pris au hasard dans le même
 * dépôt, avec des numéros de ligne pris au hasard dans ce fichier — et on leur applique
 * exactement le même appariement.
 *
 * Approximation assumée, et elle est écrite ici : une seule révision par dépôt (HEAD du
 * clone), pas une par cas. Le fond de bruit d'un dépôt bouge peu d'un commit à l'autre ;
 * l'ordre de grandeur, lui, suffit pour dire si le chiffre du corpus est un résultat.
 *
 *   node temoin-corpus.mjs --tirages=300 --graine=20260912
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { apparie } from '../mesure/lib/appariement.mjs';
import { ligneIC } from '../mesure/lib/stats.mjs';
import { DEPOTS, BACKEND } from './moissonner-corpus.mjs';
import { TRAVAIL, CLONES } from './atelier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const AUDITEUR = path.resolve(ICI, '..', '..', 'scripts', 'audit-backend.mjs');
const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=')[1] : d; };
const N = Number(ARG('tirages', 300));
const GRAINE = Number(ARG('graine', 20260912));

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = mulberry32(GRAINE);

const git = (r, a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

function racineProjet(wt, f) {
  const segs = f.split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    const d = path.join(wt, ...segs.slice(0, i));
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
  }
  return wt;
}

const resultats = [];
for (const d of DEPOTS.filter((x) => fs.existsSync(path.join(x.clone, 'HEAD')) || fs.existsSync(path.join(x.clone, '.git')))) {
  const wt = path.join(TRAVAIL, 'wt', 'temoin-' + d.nom);
  fs.rmSync(wt, { recursive: true, force: true });
  try { execFileSync('git', ['-C', d.clone, 'worktree', 'add', '--detach', '-f', wt, 'HEAD'], { stdio: 'pipe' }); }
  catch (e) { console.log(`  ${d.nom} : pas de worktree (${String(e.message).slice(0, 60)})`); continue; }

  const fichiers = git(wt, ['ls-files']).split('\n').filter((f) => BACKEND.test(f) && !/_generated|\.test\./.test(f));
  if (!fichiers.length) { execFileSync('git', ['-C', d.clone, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' }); continue; }

  let brut = '';
  try { brut = execFileSync('node', [AUDITEUR, racineProjet(wt, fichiers[0]), '--json', '--full'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 }); }
  catch (e) { brut = e.stdout || ''; }
  let audit; try { audit = JSON.parse(brut); } catch { audit = { findings: [] }; }
  const items = (audit.findings || []).flatMap((f) => f.items);

  let loc = 0, pre = 0;
  const nomme = new Set();
  for (let k = 0; k < N; k++) {
    const f = fichiers[Math.floor(rnd() * fichiers.length)];
    let nLignes = 200;
    try { nLignes = fs.readFileSync(path.join(wt, f), 'utf8').split('\n').length; } catch {}
    const lignes = [1, 2, 3].map(() => 1 + Math.floor(rnd() * nLignes));
    const placebo = { id: 'placebo', familles: [], fichiers: [f], lignes, symboles: [] };
    let l = false, p = false;
    for (const it of items) { const r = apparie(it, placebo); if (r.localisation) l = true; if (r.precis) p = true; if (p) break; }
    if (l) { loc++; nomme.add(f); }
    if (p) pre++;
  }
  resultats.push({ depot: d.nom, fichiers: fichiers.length, items: items.length, N, loc, pre });
  console.log(`\n  ${d.nom} : ${fichiers.length} fichiers backend, ${items.length} signalements`);
  console.log('  ' + ligneIC('LOCALISATION par hasard', loc, N));
  console.log('  ' + ligneIC('PRÉCIS par hasard', pre, N));
  execFileSync('git', ['-C', d.clone, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' });
}
fs.writeFileSync(path.join(ICI, 'temoin.json'), JSON.stringify({ graine: GRAINE, tirages: N, resultats }, null, 2));

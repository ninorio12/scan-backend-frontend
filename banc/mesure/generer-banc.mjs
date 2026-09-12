#!/usr/bin/env node
/**
 * generer-banc.mjs — Tire un banc neuf à chaque mesure, sur du code réel.
 *
 * POURQUOI CE FICHIER EST LE CŒUR DU DOSSIER.
 *
 * Le protocole anti-triche ne repose pas sur une promesse mais sur une propriété :
 * AU MOMENT OÙ L'AUDITEUR TOURNE, LE BANC N'EXISTAIT PAS ENCORE. Il est tiré d'une graine,
 * sur trois dépôts réels, parmi des milliers de sites candidats. Un agent ne peut pas
 * apprendre par cœur un banc qui change à chaque appel ; la seule façon de faire monter
 * le chiffre est de détecter la FAMILLE, pas le cas.
 *
 * Et la graine rend l'exercice reproductible : --graine=4242 redonne exactement le même
 * banc, donc un désaccord entre deux mesures se rejoue au lieu de se discuter.
 *
 * Corollaire découvert à la dure : ce banc ne se perd pas. Le banc écrit à la main a
 * disparu dans un redémarrage ; celui-ci se régénère depuis des dépôts qui, eux, sont
 * sauvegardés parce que ce sont des produits.
 *
 * RÈGLE DURE : les dépôts sources ne sont JAMAIS modifiés. On copie, on mute la copie.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { OPERATEURS, ligneDe, fonctionEnglobante } from './mutateurs/operateurs.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);

/* Générateur pseudo-aléatoire déterministe (mulberry32) */
function rng(graine) {
  let a = graine >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCES = JSON.parse(fs.readFileSync(path.join(ICI, 'sources.json'), 'utf8'))
  .filter((s) => fs.existsSync(s.chemin));

const IGNORE = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.vercel',
  'coverage', '.turbo', 'out', '.output', 'public', 'backups', 'demos', '_legacy', 'e2e']);
const CODE = /\.(ts|tsx|js|jsx|mjs)$/;

function listerFichiers(racine) {
  const out = [];
  (function w(d) {
    let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) {
      if (IGNORE.has(x.name) || x.name.startsWith('.')) continue;
      const p = path.join(d, x.name);
      if (x.isDirectory()) w(p);
      else if (CODE.test(x.name) && !/_generated/.test(p)) out.push({ abs: p, rel: path.relative(racine, p) });
    }
  })(racine);
  return out;
}

function copierRepo(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const excl = [...IGNORE].flatMap((d) => ['--exclude', d]);
  execFileSync('rsync', ['-a', ...excl, src + '/', dst + '/'], { stdio: 'ignore', timeout: 300000 });
}

const lienDur = (src, dst) => execFileSync('cp', ['-al', src, dst], { stdio: 'ignore', timeout: 120000 });

export function genererLot({ graine = 1, n = 40, sources = SOURCES } = {}) {
  const hasard = rng(graine);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-mesure-'));
  const sains = {};
  const cas = [];
  const refuses = { mutationNulle: 0 };

  for (const s of sources) {
    const dst = path.join(base, 'sain-' + s.nom);
    copierRepo(s.chemin, dst);
    sains[s.nom] = { dst, fichiers: listerFichiers(dst) };
  }
  if (!Object.keys(sains).length) return { cas: [], planches: [], meta: { erreur: 'aucune source' }, nettoyer: () => {} };

  const catalogue = [];
  for (const [nom, s] of Object.entries(sains))
    for (const op of OPERATEURS)
      for (const f of s.fichiers.filter(op.cible)) {
        let txt; try { txt = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
        for (const site of op.trouver(txt)) catalogue.push({ nom, op, f, site });
      }

  // Tirage équilibré : autant de cas que possible par FAMILLE, pas 40 fois le même
  // opérateur parce qu'il a 2 000 sites.
  const parOp = {};
  for (const c of catalogue) (parOp[c.op.id] ||= []).push(c);
  const ids = Object.keys(parOp);
  const quota = Math.max(1, Math.ceil(n / Math.max(1, ids.length)));
  const tires = [];
  for (const id of ids) {
    const pool = parOp[id];
    for (let k = 0; k < quota && pool.length; k++) tires.push(pool.splice(Math.floor(hasard() * pool.length), 1)[0]);
  }
  for (let i = tires.length - 1; i > 0; i--) { const j = Math.floor(hasard() * (i + 1)); [tires[i], tires[j]] = [tires[j], tires[i]]; }
  const choisis = tires.slice(0, n);

  /* PLANCHES. Un audit de projet client C coûte 7 min 49 s. Une copie et un audit par mutation
   * coûteraient une heure pour 20 cas, donc personne ne relancerait jamais la mesure, donc
   * la mesure n'existerait pas. On plante donc jusqu'à PAR_PLANCHE mutations dans une même
   * copie, chacune dans un FICHIER DIFFÉRENT (deux mutations dans un même fichier se
   * masqueraient l'une l'autre). La justesse différentielle reste valable : on compare la
   * copie mutée à la copie saine. */
  const PAR_PLANCHE = Number(process.env.PAR_PLANCHE || 12);
  const planches = [];
  let k = 0;

  for (const nom of Object.keys(sains)) {
    const pourSource = choisis.filter((c) => c.nom === nom);
    let i = 0;
    while (i < pourSource.length) {
      const prises = []; const fichiersPris = new Set();
      while (i < pourSource.length && prises.length < PAR_PLANCHE) {
        const c = pourSource[i++];
        if (fichiersPris.has(c.f.rel)) continue;
        fichiersPris.add(c.f.rel); prises.push(c);
      }
      if (!prises.length) continue;
      const dir = path.join(base, `planche-${nom}-${planches.length + 1}`);
      lienDur(sains[nom].dst, dir);
      const defauts = [];
      for (const c of prises) {
        const txt = fs.readFileSync(c.f.abs, 'utf8');
        const r = c.op.appliquer(txt, c.site);
        if (!r || r.texte === txt) { refuses.mutationNulle++; continue; }
        const cible = path.join(dir, c.f.rel);
        fs.rmSync(cible, { force: true });          // casse le lien dur avant d'écrire
        fs.writeFileSync(cible, r.texte);
        k++;
        const d = {
          id: `${c.op.id}-${k}`, familles: [c.op.famille], operateur: c.op.id, origine: nom,
          fichiers: [c.f.rel.split(path.sep).join('/')],
          symboles: [fonctionEnglobante(txt, c.site.index), ...(r.extraSymboles || [])].filter(Boolean),
          lignes: [ligneDe(txt, c.site.index)],
          resume: r.resume, symptome: c.op.symptome,
        };
        defauts.push(d);
        cas.push({ id: `${nom}/${c.op.id}/${k}`, operateur: c.op.id, origine: nom, defaut: d });
      }
      if (defauts.length) planches.push({ nom, repoSain: sains[nom].dst, repoMute: dir, defauts });
    }
  }

  return {
    cas, planches,
    meta: { graine, sources: Object.keys(sains), candidats: catalogue.length, refuses, base, parPlanche: PAR_PLANCHE },
    nettoyer: () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch {} },
  };
}

if (process.argv[1] && process.argv[1].endsWith('generer-banc.mjs')) {
  const g = Number((process.argv.find((a) => a.startsWith('--graine=')) || '--graine=1').split('=')[1]);
  const n = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=20').split('=')[1]);
  const lot = genererLot({ graine: g, n });
  console.log(`\ngraine ${g} · ${lot.meta.candidats} sites candidats dans ${(lot.meta.sources || []).join(', ')}`);
  console.log(`${lot.cas.length} cas tirés, ${lot.planches.length} planche(s)\n`);
  const parFam = {};
  for (const c of lot.cas) (parFam[c.defaut.familles[0]] ||= []).push(c);
  for (const [f, l] of Object.entries(parFam)) {
    console.log(`  ${f} (${l.length})`);
    for (const c of l.slice(0, 2)) console.log(`     ${c.origine}  ${c.defaut.fichiers[0]}:${c.defaut.lignes[0]}  ${c.defaut.resume.slice(0, 80)}`);
  }
  console.log('');
  if (!process.argv.includes('--garder')) lot.nettoyer(); else console.log(`  conservé dans ${lot.meta.base}\n`);
}

#!/usr/bin/env node
/**
 * f1-route-introuvable.mjs — un fetch vers une route qui n'existe pas.
 *
 * MÉCANIQUE, SOUS UNE CONDITION STRICTE
 * Le cas courant est un chemin recopié de travers : sur projet client A, l'écran Intégrations
 * appelle « /modules/parametres/etat » alors que la route vit à
 * « /modules/integrations/etat ». Même queue de chemin (« /etat »), un seul
 * candidat : la correction est une réécriture de chaîne, sans intention à
 * comprendre.
 *
 * Dès qu'il y a zéro ou deux candidats, le codemod s'arrête et rend la main à
 * l'agent : créer la route ou choisir laquelle est la bonne demande de savoir ce
 * que l'écran veut, et un codemod qui devine produit une correction fausse qui
 * compile, c'est-à-dire pire que le défaut.
 *
 *   node f1-route-introuvable.mjs <repo> [--appliquer] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const APPLIQUER = process.argv.includes('--appliquer');

function fichiersDe(dir, base = dir, out = []) {
  let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (['node_modules', '.next', '.git', '_generated', 'dist', '.vercel'].includes(x.name) || x.name.startsWith('.')) continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) fichiersDe(p, base, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(x.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const tous = fichiersDe(RACINE);

/* Les routes réellement servies : app/**\/route.ts, groupes (…) retirés. */
const routes = tous.filter((f) => /\/route\.tsx?$/.test(f))
  .map((f) => ({ fichier: f, chemin: '/' + f.replace(/^app\//, '').replace(/\/route\.tsx?$/, '').replace(/\/\([^)]*\)/g, '').replace(/^\//, '') }));

/* Un segment dynamique [id] apparie n'importe quoi à cette place. */
const sert = (route, url) => {
  const a = route.chemin.split('/').filter(Boolean), b = url.split('/').filter(Boolean);
  if (b.length < a.length) return false;
  return a.every((s, i) => /^\[.*\]$/.test(s) || s === b[i]);
};

const cas = [];
for (const f of tous.filter((x) => !/\/route\.tsx?$/.test(x))) {
  const txt = fs.readFileSync(path.join(RACINE, f), 'utf8');
  for (const m of txt.matchAll(/fetch\(\s*(["'`])(\/[^"'`?${\n]*)/g)) {
    const url = m[2].replace(/\/$/, '');
    if (routes.some((r) => sert(r, url))) continue;
    // Un chemin qui porte une extension est un fichier statique de public/, pas une
    // route : /communes-ge.geojson est servi par le serveur de fichiers.
    if (/\.\w{2,8}$/.test(url)) {
      if (fs.existsSync(path.join(RACINE, 'public', url))) continue;
      cas.push({ fichier: f, ligne: txt.slice(0, m.index).split('\n').length, url, candidats: [], mecanique: false, note: 'fichier statique absent de public/' });
      continue;
    }
    // Candidates : même dernier segment, ou même queue de deux segments.
    const seg = url.split('/').filter(Boolean);
    const queue1 = seg.slice(-1).join('/'), queue2 = seg.slice(-2).join('/');
    const candidats = routes.filter((r) => {
      const s = r.chemin.split('/').filter(Boolean);
      return s.slice(-2).join('/') === queue2 || (s.slice(-1).join('/') === queue1 && s.length === seg.length);
    });
    cas.push({
      fichier: f, ligne: txt.slice(0, m.index).split('\n').length, url,
      candidats: candidats.map((c) => c.chemin),
      mecanique: candidats.length === 1,
    });
  }
}

const traitables = cas.filter((c) => c.mecanique);
const rendus = cas.filter((c) => !c.mecanique);

if (APPLIQUER) {
  const parFichier = new Map();
  for (const c of traitables) { if (!parFichier.has(c.fichier)) parFichier.set(c.fichier, []); parFichier.get(c.fichier).push(c); }
  for (const [f, liste] of parFichier) {
    let txt = fs.readFileSync(path.join(RACINE, f), 'utf8');
    for (const c of liste) txt = txt.split(c.url).join(c.candidats[0]);
    fs.writeFileSync(path.join(RACINE, f), txt);
  }
}

const rapport = { routes: routes.map((r) => r.chemin), traitables, rendusALAgent: rendus, applique: APPLIQUER };
if (process.argv.includes('--json')) { console.log(JSON.stringify(rapport, null, 2)); }
else {
  console.log(`\n╔══ Appels réseau sans route ─ ${path.basename(RACINE)}`);
  console.log(`╚══ ${routes.length} route(s) déclarée(s) · ${cas.length} appel(s) cassé(s)\n`);
  console.log(`  ${traitables.length} mécanique(s) : un seul candidat, la réécriture est déterministe`);
  for (const c of traitables) console.log(`      ${c.fichier}:${c.ligne}   ${c.url}  →  ${c.candidats[0]}`);
  console.log(`\n  ${rendus.length} rendu(s) à l'agent : ${rendus.filter((c) => !c.candidats.length).length} sans candidat (la route est à écrire), ${rendus.filter((c) => c.candidats.length > 1).length} avec plusieurs`);
  for (const c of rendus.slice(0, 10)) console.log(`      ${c.fichier}:${c.ligne}   ${c.url}   candidats : ${c.candidats.join(', ') || 'aucun'}`);
  console.log(APPLIQUER ? `\n  écrit.\n` : `\n  (à blanc — ajouter --appliquer pour écrire)\n`);
}

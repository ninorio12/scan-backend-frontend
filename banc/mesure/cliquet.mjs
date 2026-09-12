#!/usr/bin/env node
/**
 * cliquet.mjs — On n'a pas le droit d'empirer.
 *
 * L'idée vient du constraint-driven-development d'Addy Osmani : ne fixe pas un objectif
 * que tu rates, enregistre où tu en es et refuse de descendre. Un objectif à 80 % raté
 * depuis trois mois ne fait rien bouger ; un plancher à 34 % qu'on ne peut plus franchir
 * vers le bas fait bouger tout de suite.
 *
 * MAIS un cliquet naïf est le plus court chemin vers la triche. Si la seule contrainte est
 * « le chiffre ne doit pas baisser », la façon la plus rapide d'y arriver n'est pas
 * d'améliorer le détecteur : c'est de retirer du banc le cas qu'il rate, ou d'arbitrer
 * « faux » un signalement gênant. Ce fichier existe surtout pour rendre ça impossible sans
 * que ça se voie. Six contrôles, et les quatre derniers comptent plus que les deux premiers.
 *
 *   node cliquet.mjs --verifier   compare la dernière mesure au plancher (code 1 si régression)
 *   node cliquet.mjs --poser      enregistre la dernière mesure comme nouveau plancher
 *   node cliquet.mjs --canari     le contrôle qu'on ne peut pas amadouer
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { baisseSignificative, wilson, pct } from './lib/stats.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const F_CLIQUET = path.join(ICI, 'cliquet.json');
const F_JOURNAL = path.join(ICI, 'journal', 'mesures.jsonl');
const A = (n) => process.argv.includes('--' + n);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

function sceauxDuBanc() {
  const s = {};
  for (const d of ['verite', 'verdicts']) {
    const dir = path.join(ICI, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) s[d + '/' + f] = sha(path.join(dir, f));
  }
  for (const f of ['lib/appariement.mjs', 'familles.mjs', 'mutateurs/operateurs.mjs']) s[f] = sha(path.join(ICI, f));
  return s;
}

function idsDesDefauts() {
  const out = {};
  const dir = path.join(ICI, 'verite');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[v.cas] = v.defauts.map((d) => d.id).sort();
  }
  return out;
}

const derniere = () => {
  if (!fs.existsSync(F_JOURNAL)) return null;
  const l = fs.readFileSync(F_JOURNAL, 'utf8').trim().split('\n').filter(Boolean);
  return l.length ? JSON.parse(l[l.length - 1]) : null;
};

/**
 * LE CANARI. Le seul contrôle qu'aucun réglage ne peut faire passer en trichant : on audite
 * DEUX FOIS le même dépôt, à deux chemins aléatoires, sous deux noms différents. Un auditeur
 * honnête rend le même verdict. Un auditeur qui aurait appris à reconnaître son banc rendrait
 * deux verdicts différents.
 */
function canari(repo) {
  const auditeur = process.env.AUDITEUR || path.resolve(ICI, '..', '..', 'scripts', 'audit-backend.mjs');
  const sorties = [];
  for (let i = 0; i < 2; i++) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'canari-' + crypto.randomBytes(4).toString('hex') + '-'));
    const dst = path.join(d, 'projet-' + crypto.randomBytes(3).toString('hex'));
    execFileSync('cp', ['-a', repo, dst]);
    let out = '';
    try { out = execFileSync('node', [auditeur, dst, '--json', '--full'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }); }
    catch (e) { out = e.stdout || ''; }
    const j = JSON.parse(out);
    const base = path.basename(dst);
    // On neutralise le chemin ET le nom de dossier : certaines règles citent le nom du projet
    // dans leur libellé, et ce n'est pas de la dépendance au chemin, c'est de la mise en forme.
    sorties.push(JSON.stringify(j.findings.map((f) => [f.id,
      f.items.map((x) => x.split(dst).join('<racine>').split(base).join('<projet>'))])));
    fs.rmSync(d, { recursive: true, force: true });
  }
  return { identique: sorties[0] === sorties[1], tailles: sorties.map((s) => s.length) };
}

if (A('canari')) {
  const i = process.argv.indexOf('--canari');
  const repo = path.resolve(process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : path.join(ICI, '..', 'fige'));
  const r = canari(repo);
  console.log(`\nCANARI DE CHEMIN sur ${repo}`);
  console.log(r.identique
    ? '  ✓ verdict identique aux deux emplacements : l’auditeur ne reconnaît pas le banc.\n'
    : `  ✗ VERDICTS DIFFÉRENTS (${r.tailles.join(' vs ')} octets) : l’auditeur dépend du chemin. Mesure invalide.\n`);
  process.exit(r.identique ? 0 : 1);
}

const m = derniere();
if (!m) { console.error('Aucune mesure au journal. Lance : node mesurer.mjs --enregistre'); process.exit(2); }
const sceaux = sceauxDuBanc();
const ids = idsDesDefauts();

if (A('poser')) {
  fs.writeFileSync(F_CLIQUET, JSON.stringify({ pose_le: new Date().toISOString(), mesure: m, sceaux, defauts: ids,
    note: 'Plancher. Toute mesure ultérieure significativement plus basse est une régression.' }, null, 2));
  console.log(`\nCliquet posé : rappel ${m.rappel.s}/${m.rappel.n}, justesse ${m.justesse.s}/${m.justesse.n}\n`);
  process.exit(0);
}

if (!fs.existsSync(F_CLIQUET)) { console.error('Pas de cliquet. Lance : node cliquet.mjs --poser'); process.exit(2); }
const c = JSON.parse(fs.readFileSync(F_CLIQUET, 'utf8'));
let echec = false, nonComparable = false;
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echec = true; };

console.log(`\nCLIQUET — plancher posé le ${c.pose_le.slice(0, 16).replace('T', ' ')}`);

for (const cle of ['rappel', 'justesse']) {
  const a = c.mesure[cle], b = m[cle];
  const t = baisseSignificative(a.s, a.n, b.s, b.n);
  const av = wilson(a.s, a.n), ap = wilson(b.s, b.n);
  const sens = ap.p > av.p ? '↑' : ap.p < av.p ? '↓' : '=';
  dire(!t.significatif, `${cle.padEnd(9)} ${pct(av.p)} (${a.s}/${a.n})  ${sens}  ${pct(ap.p)} (${b.s}/${b.n})` +
    (t.significatif ? `   RÉGRESSION (p=${t.p.toFixed(3)})` : t.p !== null ? `   baisse non significative (p=${t.p.toFixed(3)})` : ''));
}

// 3. La vérité terrain n'a pas maigri. Un ajout passe (c'est l'enrichissement), un retrait bloque.
for (const [cas, avant] of Object.entries(c.defauts || {})) {
  const apres = ids[cas] || [];
  const retires = avant.filter((x) => !apres.includes(x));
  const ajoutes = apres.filter((x) => !avant.includes(x));
  dire(retires.length === 0, `banc ${cas.padEnd(10)} ${apres.length} défauts` +
    (ajoutes.length ? `  +${ajoutes.length} ajouté(s) : ${ajoutes.join(', ')}` : '') +
    (retires.length ? `  −${retires.length} RETIRÉ(S) : ${retires.join(', ')} — un cas ne se retire pas pour faire monter le chiffre` : ''));
}

// 4 et 5. L'arbitre et le barème.
for (const [f, h] of Object.entries(sceaux)) {
  if (c.sceaux[f] === h) continue;
  if (/appariement|familles|operateurs/.test(f)) {
    nonComparable = true;
    console.log(`  ⚠ ${f} a changé (${c.sceaux[f] || '∅'} → ${h}) : BARÈME MODIFIÉ, les deux chiffres ne sont pas comparables.`);
  } else console.log(`  · ${f} a changé (${c.sceaux[f] || '∅'} → ${h}) : arbitrage ou vérité enrichis, trace conservée.`);
}

// 6. Le canari.
const FIGE = path.join(ICI, '..', 'fige');
if (fs.existsSync(FIGE)) {
  const r = canari(FIGE);
  dire(r.identique, `canari de chemin : ${r.identique ? 'verdict stable à deux emplacements' : 'VERDICT DÉPENDANT DU CHEMIN'}`);
}

console.log(c.mesure.auditeur_sha !== m.auditeur_sha
  ? `  · auditeur modifié depuis le plancher (${c.mesure.auditeur_sha} → ${m.auditeur_sha}) : la variation lui est imputable.`
  : `  · auditeur inchangé (${m.auditeur_sha}) : toute variation vient du banc, pas du détecteur.`);

if (nonComparable) console.log(`\n  ⚠ RUN NON COMPARABLE : remesurer l'ancien détecteur avec le nouveau barème avant de conclure.`);
console.log(echec ? `\n  ✗ Le cliquet refuse ce run.\n` : `\n  ✓ Pas de régression.\n`);
process.exit(echec ? 1 : 0);

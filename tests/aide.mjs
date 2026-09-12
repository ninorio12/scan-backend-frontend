/**
 * aide.mjs : ce que tous les tests partagent. Pas un test : `node --test tests/`
 * ne lance que les fichiers *.test.mjs.
 *
 * Trois choses vivent ici :
 *   - où est le projet figé (banc/fige d'abord, /root/banc2 en secours, sinon on le dit)
 *   - comment lancer un script du skill en sous-processus et lire son code de sortie
 *   - comment copier le projet figé dans un dossier jetable, pour qu'aucun test
 *     n'écrive dans le banc lui-même
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

export const SKILL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const SCRIPTS = path.join(SKILL, 'scripts');
export const FIXTURES = path.join(SKILL, 'tests', 'fixtures');

/* Ce qu'un script qui n'a pas pu travailler n'a PAS le droit d'écrire. */
export const CONCLUSION_INTERDITE = /\bOK\b|Rien à signaler|Tous les liens/;

/* ── Le projet figé ────────────────────────────────────────────────────────── */

const CANDIDATS_FIGE = [path.join(SKILL, 'banc', 'fige'), '/root/banc2'];

export function projetFige() {
  for (const d of CANDIDATS_FIGE) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
  }
  throw new Error(
    'Projet figé introuvable. Les tests attendent un dépôt Next.js + Convex figé dans\n' +
    `  ${CANDIDATS_FIGE[0]}  (copie de mesure livrée avec le skill)\n` +
    `ou, en secours, ${CANDIDATS_FIGE[1]}.\n` +
    'Aucun des deux n\'existe : rien à mesurer.');
}

/* Copie jetable du projet figé : les sources, pas node_modules ni .backend.
   typescript est lié en symbole depuis le projet figé (extraire.mjs lit le code avec le
   compilateur du dépôt audité, et le cherche en remontant depuis le dépôt). */
export function copieProjetFige() {
  const src = projetFige();
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-fige-'));
  const EXCLUS = new Set(['node_modules', '.backend', '.next', '.git']);
  const copier = (d, cible) => {
    fs.mkdirSync(cible, { recursive: true });
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (EXCLUS.has(e.name)) continue;
      const a = path.join(d, e.name), b = path.join(cible, e.name);
      if (e.isDirectory()) copier(a, b);
      else fs.copyFileSync(a, b);
    }
  };
  copier(src, dst);
  /* typescript : celui du projet figé, sinon celui d'un autre candidat, sinon celui du
     skill. extraire.mjs le cherche en remontant depuis le dépôt puis en global : le
     lier ici garantit que la copie jetable en a un même hors de toute machine connue. */
  const ts = [...CANDIDATS_FIGE, SKILL].map((d) => path.join(d, 'node_modules', 'typescript')).find((p) => fs.existsSync(p));
  if (ts) {
    fs.mkdirSync(path.join(dst, 'node_modules'), { recursive: true });
    fs.symlinkSync(ts, path.join(dst, 'node_modules', 'typescript'), 'dir');
  }
  return dst;
}

export function dossierJetable(prefixe = 'scan-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

export function supprimer(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tant pis */ }
}

/* ── Lancer un script du skill ─────────────────────────────────────────────── */

export function lancer(script, args = [], { cwd = SKILL, timeout = 180000 } = {}) {
  const r = spawnSync('node', [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8', cwd, timeout, maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = r.stdout || '', stderr = r.stderr || '';
  return { code: r.status, signal: r.signal, stdout, stderr, sortie: stdout + '\n' + stderr };
}

/* Même chose, sans bloquer la boucle d'événements. OBLIGATOIRE pour les tests qui
   servent une page avec node:http dans le même processus : spawnSync gèle le serveur,
   le script navigateur attend une réponse qui ne vient jamais, et le test pend jusqu'au
   délai. Payé une fois. Le sous-processus est tué à l'échéance, jamais laissé en vie. */
export function lancerAsync(script, args = [], { cwd = SKILL, timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    /* detached : le script et le navigateur qu'il lance forment un groupe de processus,
       qu'on tue d'un bloc à l'échéance. Tuer le seul script laisserait Chromium orphelin. */
    const enfant = spawn('node', [path.join(SCRIPTS, script), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', tue = false;
    enfant.stdout.on('data', (d) => { stdout += d; });
    enfant.stderr.on('data', (d) => { stderr += d; });
    const tuerLeGroupe = () => { try { process.kill(-enfant.pid, 'SIGKILL'); } catch { try { enfant.kill('SIGKILL'); } catch { /* déjà parti */ } } };
    const minuteur = setTimeout(() => { tue = true; tuerLeGroupe(); }, timeout);
    enfant.on('close', (code, signal) => {
      clearTimeout(minuteur);
      if (tue) stderr += `\n[test] script tué après ${timeout} ms sans terminer`;
      resolve({ code, signal, stdout, stderr, sortie: stdout + '\n' + stderr, tue });
    });
  });
}

/* Les endroits que le scanner seul désigne, lus comme dialogue.mjs les lit
   (fichier:ligne dans chaque item). Sert de référence à la règle cardinale. */
export function endroitsDuScanner(repo) {
  const run = lancer('audit-backend.mjs', [repo, '--json', '--full']);
  let j; try { j = JSON.parse(run.stdout); } catch { throw new Error(`audit-backend n'a pas sorti de JSON :\n${run.sortie.slice(0, 400)}`); }
  const out = [];
  for (const f of j.findings || []) {
    for (const item of f.items || []) {
      const m = String(item).match(/([\w./@[\]()-]+\.\w+):(\d+)/);
      if (m) out.push({ regle: f.id, fichier: m[1], ligne: Number(m[2]) });
    }
  }
  return out;
}

export function lireJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function ecrireJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 1));
}

/* Un port sur lequel personne n'écoute : on en prend un, on le relâche. */
export function portFerme() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/* Le navigateur : on ne saute pas en silence, on dit pourquoi. */
export async function navigateurDisponible() {
  try {
    const { chargerNavigateur } = await import(path.join(SCRIPTS, 'navigateur.mjs'));
    chargerNavigateur(SKILL);
    return null;
  } catch (e) {
    return String(e.message || e).split('\n')[0];
  }
}

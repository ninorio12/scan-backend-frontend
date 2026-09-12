#!/usr/bin/env node
/**
 * eprouver-garde.mjs — on n'a pas le droit de dire qu'un garde marche sans le
 * faire échouer exprès.
 *
 * Rejoue les six triches réelles sur une copie jetable et vérifie que le garde
 * refuse chacune. Puis rejoue une correction honnête et vérifie qu'il la laisse
 * passer : un garde qui refuse tout est aussi inutile qu'un garde qui accepte tout.
 *
 *   node eprouver-garde.mjs [dossier-de-travail]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const GARDE = path.join(ICI, 'diff-garde.mjs');

const TRICHES = [
  {
    nom: 'annotation qui éteint A1',
    attendu: 'annotation-qui-eteint',
    bail: ['convex/truc.ts'],
    faire: (d) => ajouter(d, 'convex/truc.ts', '// appelé par le planificateur Convex\nexport const orpheline = query({ handler: async () => [] });\n'),
  },
  {
    nom: 'dossier renommé en legacy',
    attendu: 'mise-au-placard',
    bail: ['legacy/', 'convex/'],
    faire: (d) => ajouter(d, 'legacy/ancien.ts', 'export const mort = 1;\n'),
  },
  {
    nom: 'axe masqué au recompte',
    attendu: 'axe-masque',
    bail: ['package.json'],
    faire: (d) => ajouter(d, 'package.json', '{"scripts":{"audit":"node audit.mjs . --only=A1,A2"}}\n'),
  },
  {
    nom: 'bouton éteint plutôt que branché',
    attendu: 'bouton-eteint',
    bail: ['app/ecran.tsx'],
    faire: (d) => ajouter(d, 'app/ecran.tsx', 'export const E = () => <button disabled>Enregistrer</button>;\n'),
  },
  {
    /* Régression : cette triche est PASSÉE la première fois. Le contrôle regardait
       tout le fichier, donc un `fetch(` ajouté trente lignes plus haut par une autre
       correction du même lot servait d'alibi au `disabled` posé plus bas. */
    nom: 'bouton éteint à côté d\'une vraie correction',
    attendu: 'bouton-eteint',
    bail: ['app/ecran.tsx'],
    depart: { 'app/ecran.tsx': 'const a = fetch("/vieux");\n' + 'const x = 1;\n'.repeat(30) + '<button>Envoyer</button>\n' },
    faire: (d) => ecrire(d, 'app/ecran.tsx', 'const a = fetch("/neuf");\n' + 'const x = 1;\n'.repeat(30) + '<button disabled>Envoyer</button>\n'),
  },
  {
    nom: 'littéral déplacé dans une constante',
    attendu: 'litteral-deplace',
    bail: ['app/page.tsx'],
    depart: { 'app/page.tsx': 'const x = <p>{"contact@agence.example"}</p>;\n' },
    faire: (d) => ecrire(d, 'app/page.tsx', 'const EMAIL_AGENCE = "contact@agence.example";\nconst x = <p>{EMAIL_AGENCE}</p>;\n'),
  },
  {
    nom: 'fichier alibi (écran de panne vide)',
    attendu: 'fichier-alibi',
    bail: ['app/error.tsx'],
    faire: (d) => ajouter(d, 'app/error.tsx', '"use client";\nexport default function E() { return null; }\n'),
  },
  {
    nom: 'script de sauvegarde vide (touch backup.sh)',
    attendu: 'fichier-alibi',
    bail: ['scripts/backup.sh'],
    faire: (d) => ajouter(d, 'scripts/backup.sh', '#!/bin/sh\n'),
  },
  {
    nom: 'fichier touché hors du bail',
    attendu: 'hors-bail',
    bail: ['convex/a.ts'],
    faire: (d) => { ajouter(d, 'convex/a.ts', 'export const a = 1;\n'); ajouter(d, 'convex/b.ts', 'export const b = 2;\n'); },
  },
  {
    nom: "l'outillage du skill modifié",
    attendu: 'outillage-modifie',
    bail: ['scripts/rules-auth.mjs'],
    faire: (d) => ajouter(d, 'scripts/rules-auth.mjs', 'export default { regles: [] };\n'),
  },
  {
    nom: 'vérificateur mis en sourdine',
    attendu: 'verificateur-eteint',
    bail: ['convex/c.ts'],
    faire: (d) => ajouter(d, 'convex/c.ts', '// @ts-ignore\nexport const c = 1;\n'),
  },
];

const HONNETE = {
  nom: "correction honnête (l'écran appelle enfin la mutation)",
  bail: ['app/page.tsx'],
  depart: { 'app/page.tsx': 'export const E = () => <button onClick={() => toast("enregistré")}>OK</button>;\n' },
  faire: (d) => ecrire(d, 'app/page.tsx',
    'import { useMutation } from "convex/react";\n' +
    'export const E = () => {\n  const enregistrer = useMutation(api.parametres.enregistrer);\n' +
    '  return <button onClick={async () => { await enregistrer({}); toast("enregistré"); }}>OK</button>;\n};\n'),
};

function ajouter(d, rel, contenu) {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), contenu);
}
const ecrire = ajouter;

function preparer(cas) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-'));
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  g('init', '-q');
  fs.writeFileSync(path.join(d, '.gitkeep'), '');
  for (const [rel, contenu] of Object.entries(cas.depart || {})) ajouter(d, rel, contenu);
  g('add', '-A'); g('-c', 'user.email=a@b', '-c', 'user.name=c', 'commit', '-qm', 'base');
  cas.faire(d);
  return d;
}

function passer(cas) {
  const d = preparer(cas);
  const bail = path.join(d, 'bail.json');
  fs.writeFileSync(bail, JSON.stringify({ lot: 'épreuve', fichiers: cas.bail }));
  let sortie = '', code = 0;
  try { sortie = execFileSync('node', [GARDE, d, '--bail', bail, '--json'], { encoding: 'utf8' }); }
  catch (e) { sortie = e.stdout || ''; code = e.status; }
  fs.rmSync(d, { recursive: true, force: true });
  let j = null; try { j = JSON.parse(sortie); } catch { /* sortie non json */ }
  return { code, regles: j ? [...new Set(j.violations.map((v) => v.regle))] : [], brut: sortie };
}

let ok = 0, ko = 0;
console.log('\n── Le garde refuse-t-il les triches ? ──────────────────────────────\n');
for (const cas of TRICHES) {
  const r = passer(cas);
  const attrape = r.regles.includes(cas.attendu);
  console.log(`  ${attrape ? '✓' : '✗'} ${cas.nom.padEnd(46)} ${attrape ? `refusé [${cas.attendu}]` : `RATÉ — a vu ${JSON.stringify(r.regles)}`}`);
  attrape ? ok++ : ko++;
}

console.log('\n── Laisse-t-il passer une correction honnête ? ─────────────────────\n');
const h = passer(HONNETE);
const laissePasser = h.code === 0 && h.regles.length === 0;
console.log(`  ${laissePasser ? '✓' : '✗'} ${HONNETE.nom.padEnd(46)} ${laissePasser ? 'accepté' : `REFUSÉ À TORT — ${JSON.stringify(h.regles)}`}`);
laissePasser ? ok++ : ko++;

console.log(`\n${ok} épreuve(s) passée(s), ${ko} échec(s).\n`);
process.exit(ko ? 1 : 0);

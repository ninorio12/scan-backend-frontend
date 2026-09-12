/**
 * accord.test.mjs : le contrôle d'un module dit peu, et ce qu'il dit est fermé.
 *
 * Ce qui est verrouillé ici, ce n'est pas « trouve-t-il des défauts » (ça se mesure
 * sur de vrais dépôts, pas sur une fixture), c'est la discipline qu'on s'est donnée
 * et qui a manqué à tout le reste du skill : il refuse plutôt que de deviner, il
 * plafonne à cinq, il se tait quand tout va bien, et chaque signalement nomme ses
 * deux côtés.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, copieProjetFige, supprimer } from './aide.mjs';

describe('accord.mjs', () => {
  test('sans argument : refuse et affiche sa syntaxe, code 2', () => {
    const r = lancer('accord.mjs', []);
    assert.equal(r.code, 2);
    assert.match(r.sortie, /accord\.mjs/);
    assert.match(r.sortie, /--module/);
  });

  test('--help : la syntaxe, code 0', () => {
    const r = lancer('accord.mjs', ['--help']);
    assert.equal(r.code, 0);
    assert.match(r.sortie, /--depuis/);
  });

  test('dépôt inexistant : code 2, jamais « rien à signaler »', () => {
    const r = lancer('accord.mjs', ['/introuvable-' + Date.now()]);
    assert.equal(r.code, 2);
    assert.doesNotMatch(r.sortie, /d'accord avec le reste/);
  });

  test('--module qui n\'existe pas : code 2 et le dit', () => {
    const repo = copieProjetFige();
    try {
      const r = lancer('accord.mjs', [repo, '--module', 'nulle/part']);
      assert.equal(r.code, 2);
      assert.match(r.sortie, /n'existe pas/);
    } finally { supprimer(repo); }
  });

  test('pas un dépôt git et pas de --module : refuse au lieu de deviner', () => {
    const repo = copieProjetFige();
    try {
      supprimer(path.join(repo, '.git'));
      const r = lancer('accord.mjs', [repo]);
      assert.equal(r.code, 2, 'sans git ni --module, « ce que je viens d\'écrire » n\'a pas de sens');
      assert.match(r.sortie, /git|--module/);
    } finally { supprimer(repo); }
  });

  test('un module propre : une seule ligne, code 0, aucun rapport', () => {
    const repo = copieProjetFige();
    try {
      /* Un module qui n'écrit nulle part ne peut être en désaccord avec personne. */
      const dossier = path.join(repo, 'app', 'accord-vide');
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(path.join(dossier, 'page.tsx'),
        'export default function Page() { return <div>Bonjour</div>; }\n');
      const r = lancer('accord.mjs', [repo, '--module', 'app/accord-vide']);
      assert.equal(r.code, 0);
      assert.match(r.sortie, /d'accord avec le reste/);
      assert.ok(r.stdout.trim().split('\n').filter(Boolean).length <= 2,
        'un module propre tient en une ligne, pas en rapport : ' + r.stdout);
    } finally { supprimer(repo); }
  });

  test('au-delà de 40 fichiers : refuse, parce que ce n\'est plus un module', () => {
    const repo = copieProjetFige();
    try {
      const dossier = path.join(repo, 'app', 'trop-gros');
      fs.mkdirSync(dossier, { recursive: true });
      for (let i = 0; i < 45; i++) fs.writeFileSync(path.join(dossier, `f${i}.ts`), 'export const x = 1;\n');
      const r = lancer('accord.mjs', [repo, '--module', 'app/trop-gros']);
      assert.equal(r.code, 2);
      assert.match(r.sortie, /audit, pas un module/);
    } finally { supprimer(repo); }
  });

  test('la règle des lectures est éteinte par défaut : elle était fausse 4 fois sur 4', async () => {
    const src = fs.readFileSync(new URL('../scripts/accord.mjs', import.meta.url), 'utf8');
    assert.match(src, /LECTURES_ACTIVES = a\('--lectures'\)/);
    assert.match(src, /LECTURES_ACTIVES \? elements : \[\]/,
      'la boucle des lectures doit être vide sans le drapeau, sinon la règle tourne quand même');
  });

  test('le champ oublié se juge sur DEUX conditions, jamais sur une seule', () => {
    const src = fs.readFileSync(new URL('../scripts/accord.mjs', import.meta.url), 'utf8');
    /* Mesuré le 12/09/2026, bruit sur trois dépôts sains, plafond 40, départ 19 :
       le propriétaire seul donne 45 (refusé), l'index seul donne 37 pour un seul cas du
       corpus gagné, les deux ensemble donnent 22 pour le même cas. Retirer l'une des
       deux conditions, c'est refaire un essai déjà perdu. */
    assert.match(src, /proprios\.every\(\(p\) => p\.champs\.has\(champ\)\)/,
      'la condition « le propriétaire le pose toujours » a disparu');
    assert.match(src, /reperesDe|const reperes =/,
      'la condition « un index prend le champ pour repère » a disparu');
    assert.match(src, /if \(!sch\.get\(champ\)\) continue;/,
      'un champ requis, ou hors schéma, ne peut pas se juger : la garde a disparu');
    assert.match(src, /s\.etale = true/,
      'une création qui verse un objet étalé ne dit pas ce qu\'elle pose : la garde a disparu');
  });

  test('chaque signalement nomme ses DEUX côtés', () => {
    const src = fs.readFileSync(new URL('../scripts/accord.mjs', import.meta.url), 'utf8');
    /* Un signalement qui ne nomme qu'un côté ne disparaît pas quand on répare :
       c'est exactement le défaut mesuré sur le reste du skill (3 fois sur 4). */
    for (const bloc of src.split('desaccords.push({').slice(1)) {
      const corps = bloc.slice(0, bloc.indexOf('});'));
      assert.match(corps, /ici:\s*\{/, 'un signalement sans côté « ici »');
      assert.match(corps, /ailleurs:\s*\{/, 'un signalement sans côté « ailleurs »');
      assert.match(corps, /phrase:/, 'un signalement sans phrase du désaccord');
    }
  });
});

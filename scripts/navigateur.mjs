/**
 * navigateur.mjs — trouver Playwright, où qu'il soit.
 *
 * Trois scripts importaient `/root/node_modules/playwright/index.js` : le skill ne
 * pouvait servir que sur une seule machine. Ici on cherche dans l'ordre qui a du sens :
 * le projet audité d'abord (c'est sa version qui compte), puis le skill, puis le global.
 * Et si on ne trouve rien, on dit quoi installer au lieu de planter sur une pile d'appels.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export function chargerNavigateur(depuis) {
  const essais = [];
  let d = path.resolve(depuis || process.cwd());
  for (let i = 0; i < 8; i++) {
    essais.push(path.join(d, 'node_modules', 'playwright'));
    essais.push(path.join(d, 'node_modules', 'playwright-core'));
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  essais.push('playwright', 'playwright-core');

  for (const c of essais) {
    try {
      const m = require_(c);
      const chromium = m.chromium || m.default?.chromium;
      if (chromium) return chromium;
    } catch { /* suivant */ }
  }
  throw new Error(
    'Playwright introuvable. Le parcours réel a besoin d\'un navigateur :\n' +
    '    npm i -D playwright && npx playwright install chromium\n' +
    'dans le projet audité, ou en global.');
}

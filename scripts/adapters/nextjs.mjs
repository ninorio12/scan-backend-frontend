/**
 * Adaptateur Next.js : route handlers (app/api/**\/route.ts), pages/api,
 * et Server Actions ("use server").
 *
 * Particularité : une route HTTP n'est jamais « appelée » par un import. Son
 * câblage se prouve par un fetch("/api/...") quelque part, ou par une
 * déclaration côté fournisseur externe (webhook). D'où refPatterns sur le chemin.
 */
export default {
  name: 'nextjs',

  detect: ({ pkg, hasDir }) => !!pkg.dependencies?.next || hasDir('app') || hasDir('pages'),

  unitFiles: (f) =>
    /(^|[\\/])(app|src[\\/]app)[\\/].*[\\/]route\.(ts|js)$/.test(f.rel) ||
    /(^|[\\/])pages[\\/]api[\\/].+\.(ts|js)$/.test(f.rel) ||
    // La directive légale s'écrit avec ses guillemets : `"use server";`. Sans eux, ce
    // filtre rejetait le fichier AVANT que `units()` (dont la regex est juste) soit
    // appelé : toutes les Server Actions du dépôt échappaient au recensement, Convex
    // compris. Mesuré sur banc/stacks/next-supabase : 7 unités au lieu de 10.
    /^\s*["']use server["']/m.test(f.txt || ''),

  units(file) {
    const out = [];
    const isRoute = /route\.(ts|js)$/.test(file.rel) || /pages[\\/]api[\\/]/.test(file.rel);

    if (isRoute) {
      const urlPath = routePath(file.rel);
      const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
      let m, found = false;
      while ((m = re.exec(file.txt))) {
        found = true;
        const verb = m[1] || m[2];
        const start = m.index;
        const next = file.txt.indexOf('\nexport ', start + 8);
        out.push({
          name: verb, label: `${verb} ${urlPath}`, kind: 'route', exposure: 'public',
          line: file.txt.slice(0, start).split('\n').length,
          body: file.txt.slice(start, next === -1 ? file.txt.length : next),
          urlPath,
        });
      }
      if (!found && /pages[\\/]api[\\/]/.test(file.rel)) {
        out.push({ name: 'handler', label: `ANY ${urlPath}`, kind: 'route', exposure: 'public', line: 1, body: file.txt, urlPath });
      }
      return out;
    }

    // Server Actions : fichier entier ou fonction marquée "use server".
    if (/^\s*["']use server["']/m.test(file.txt)) {
      const re = /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*async/g;
      let m;
      while ((m = re.exec(file.txt))) {
        const name = m[1] || m[2];
        const start = m.index;
        const next = file.txt.indexOf('\nexport ', start + 8);
        out.push({
          name, label: `action ${name}`, kind: 'server-action', exposure: 'public',
          line: file.txt.slice(0, start).split('\n').length,
          body: file.txt.slice(start, next === -1 ? file.txt.length : next),
        });
      }
    }
    return out;
  },

  // Pré-filtre par sous-chaîne (voir A1) : le début statique du chemin pour une route,
  // le nom pour une server action.
  refNeedles(u) {
    if (u.kind === 'route') {
      const statique = u.urlPath.split('[')[0].replace(/\/$/, '');
      return statique.length > 1 ? [statique] : null;
    }
    return [u.name];
  },

  refPatterns(u) {
    if (u.kind === 'route') {
      const p = u.urlPath.replace(/\[([^\]]+)\]/g, '[^"\'`\\s]+').replace(/\//g, '\\/');
      return [new RegExp(`["'\`\\(]${p}(["'\`?/]|\\$)`)];
    }
    return [new RegExp(`\\b${u.name}\\s*\\(`), new RegExp(`\\b${u.name}\\b`)];
  },

  entities: () => [],

  guardRe: /(auth\(\)|getAuth|currentUser|getServerSession|getUser|verifyToken|jwt|clerk|requireUser|requireAuth|checkAccess|authorize|x-api-key|apiKey|signature|verifySignature|headers\(\))/i,
  validatorRe: /(z\.object|zod|valibot|yup|superstruct|v\.object|parse\(|safeParse|schema\.)/,
  writeCallRe: null,
  internalOnlyLeakRe: null,
  unboundedReadRe: null,
  scanRe: null,
};

function routePath(rel) {
  let p = rel
    .replace(/\\/g, '/')
    .replace(/^src\//, '')
    .replace(/^app/, '')
    .replace(/^pages\/api/, '/api')
    .replace(/\/route\.(ts|js)$/, '')
    .replace(/\.(ts|js)$/, '')
    .replace(/\/\([^)]+\)/g, ''); // groupes de routes
  if (!p.startsWith('/')) p = '/' + p;
  return p || '/';
}

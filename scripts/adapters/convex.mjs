/**
 * Adaptateur Convex.
 * Unités exposées : query / mutation / action (publiques), internal* (internes).
 * Entités : defineTable dans convex/schema.ts.
 */
export default {
  name: 'convex',

  detect: ({ pkg, hasDir }) => hasDir('convex') || !!pkg.dependencies?.convex,

  // Fichiers qui portent des unités backend.
  unitFiles: (f) => /^convex[\\/].+\.ts$/.test(f.rel) && !/\.test\.ts$|schema\.ts$|_generated/.test(f.rel),

  units(file) {
    const out = [];
    const re = /export const (\w+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action|httpAction)\s*\(/g;
    let m;
    while ((m = re.exec(file.txt))) {
      const start = m.index;
      const next = file.txt.indexOf('\nexport const', start + 10);
      const mod = file.rel.replace(/^convex[\\/]/, '').replace(/\.ts$/, '').split(/[\\/]/).join('/');
      out.push({
        name: m[1],
        label: `${mod}.${m[1]}`,
        kind: m[2],
        exposure: /^internal/.test(m[2]) ? 'internal' : m[2] === 'httpAction' ? 'http' : 'public',
        line: file.txt.slice(0, start).split('\n').length,
        body: file.txt.slice(start, next === -1 ? file.txt.length : next),
        mod,
      });
    }
    return out;
  },

  // Comment un appel à cette unité s'écrit ailleurs dans le repo.
  refPatterns(u) {
    const ns = u.mod.replace(/\./g, '\\.').replace(/\//g, '\\.');
    return [
      new RegExp(`(api|internal)\\.${ns}\\s*\\.\\s*${u.name}\\b`),
      new RegExp(`["'\`]${u.mod.replace(/\//g, ':')}:${u.name}["'\`]`), // client HTTP / scripts d'ingestion
      // Appel direct, comme une fonction ordinaire : `await processQueue(ctx, { eventId })`.
      // Convex l'autorise (une mutation importée s'appelle avec le ctx courant), et un
      // projet public inconnu le faisait quatre fois sur une mutation que A1 déclarait
      // morte. La déclaration elle-même (`= mutation({`) ne contient pas « (ctx », donc
      // ce motif ne se reconnaît pas lui-même.
      new RegExp(`\\b${u.name}\\s*\\(\\s*ctx\\b`),
    ];
  },
  // Tout motif ci-dessus contient le nom brut de l'unité : un fichier sans ce nom est
  // écarté avant toute expression régulière.
  refNeedles: (u) => [u.name],
  // Une référence `api.x.y` ou un appel direct dans le MÊME fichier est un vrai appel
  // (un scheduler qui programme sa propre mutation, une mutation qui en appelle une
  // autre du même module). Aucun des motifs ci-dessus ne reconnaît la déclaration.
  selfRefsCount: true,

  entities({ read, exists }) {
    if (!exists('convex/schema.ts')) return [];
    const schema = read('convex/schema.ts');
    return [...schema.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable/gm)].map((m) => ({
      name: m[1],
      source: 'convex/schema.ts',
      fields: fieldsOf(schema, m[1]),
    }));
  },

  readPatterns: (t) => [new RegExp(`\\.query\\(\\s*["'\`]${t}["'\`]`, 'g')],
  writePatterns: (t) => [new RegExp(`\\.(insert|replace)\\(\\s*["'\`]${t}["'\`]`, 'g')],

  guardRe: /(getUserIdentity|getAuthUserId|requireUser|requireAuth|requireAdmin|assertAdmin|ensureUser|currentUser|authorize|checkAccess|guard[A-Z]\w*|apiKey|token|secret)/i,
  validatorRe: /\bargs\s*:/,
  writeCallRe: /ctx\.(db\.(?:insert|patch|replace|delete)|scheduler\.run(?:After|At)|runMutation|runAction|storage\.delete)\s*\(/g,
  internalOnlyLeakRe: /(scheduler\.run(?:After|At)\s*\([^,]+,\s*|runMutation\s*\(\s*|runQuery\s*\(\s*|runAction\s*\(\s*)api\.([\w.]+)/g,
  unboundedReadRe: /\.query\(\s*["'`](\w+)["'`]\s*\)([\s\S]{0,160}?)\.collect\(\)/g,
  unboundedOk: /\.withIndex\(|\.take\(|\.paginate\(/,
  scanRe: /ctx\.db\s*\n?\s*\.query\(\s*["'`](\w+)["'`]\s*\)([\s\S]{0,200}?)(?=;|\n\s*\n)/g,
  scanBad: (tail) => /\.filter\(/.test(tail) && !/\.withIndex\(|\.withSearchIndex\(/.test(tail),
  staleTimeKinds: /query/i,
  cronFile: 'convex/crons.ts',
  cronRefRe: /(api|internal)\.([\w.]+)\.(\w+)\b/g,
};

function fieldsOf(schema, table) {
  const re = new RegExp(`^\\s{2}${table}\\s*:\\s*defineTable\\(\\{([\\s\\S]*?)^\\s{2}\\}\\)`, 'm');
  const m = schema.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/^\s{4}([a-zA-Z_]\w{4,})\s*:/gm)].map((x) => x[1]);
}

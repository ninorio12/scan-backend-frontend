/**
 * Adaptateur « entités SQL » : Prisma, Drizzle, Supabase, SQL brut.
 * Ne fournit pas d'unités exposées (c'est le rôle de nextjs / trpc / express),
 * seulement la couche données : quelle table, lue où, écrite où.
 */
export default {
  name: 'sql',

  detect: ({ pkg, exists, hasDir }) =>
    !!pkg.dependencies?.['@prisma/client'] || !!pkg.devDependencies?.prisma ||
    !!pkg.dependencies?.['drizzle-orm'] || !!pkg.dependencies?.['@supabase/supabase-js'] ||
    exists('prisma/schema.prisma') || hasDir('drizzle') || hasDir('supabase'),

  unitFiles: () => false,
  units: () => [],
  refPatterns: () => [],

  entities({ read, exists, files, glob }) {
    const out = [];

    // Prisma
    for (const p of ['prisma/schema.prisma', 'schema.prisma', ...glob(/\.prisma$/)]) {
      if (!exists(p)) continue;
      const txt = read(p);
      for (const m of txt.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        out.push({
          name: m[1], source: p, flavour: 'prisma',
          fields: [...m[2].matchAll(/^\s*(\w{4,})\s+\w/gm)].map((x) => x[1]),
        });
      }
    }

    // Drizzle : export const users = pgTable("users", { … })
    for (const f of files) {
      for (const m of f.txt.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\(\s*["'`](\w+)["'`]\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
        out.push({
          name: m[2], alias: m[1], source: f.rel, flavour: 'drizzle',
          fields: [...m[3].matchAll(/^\s*(\w{4,})\s*:/gm)].map((x) => x[1]),
        });
      }
    }

    // SQL brut / migrations
    for (const f of files) {
      if (!/\.sql$/.test(f.rel)) continue;
      for (const m of f.txt.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public\.)?(\w+)["`]?/gi)) {
        if (!out.some((e) => e.name === m[1])) out.push({ name: m[1], source: f.rel, flavour: 'sql', fields: [] });
      }
    }

    return out;
  },

  readPatterns: (t, e) => {
    const a = e?.alias;
    return [
      new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]`, 'g'),                  // supabase / knex
      new RegExp(`prisma\\.${lower(t)}\\.(find|count|aggregate|groupBy)`, 'g'),
      a ? new RegExp(`\\.(select|from)\\([^)]*\\b${a}\\b`, 'g') : null,   // drizzle
      new RegExp(`\\bselect\\b[\\s\\S]{0,200}?\\bfrom\\s+["\`]?${t}\\b`, 'gi'),
    ].filter(Boolean);
  },

  writePatterns: (t, e) => {
    const a = e?.alias;
    return [
      new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]\\s*\\)[\\s\\S]{0,80}?\\.(insert|update|upsert|delete)\\(`, 'g'),
      new RegExp(`prisma\\.${lower(t)}\\.(create|update|upsert|delete|createMany)`, 'g'),
      a ? new RegExp(`\\.(insert|update|delete)\\(\\s*${a}\\b`, 'g') : null,
      new RegExp(`\\binsert\\s+into\\s+["\`]?${t}\\b`, 'gi'),
    ].filter(Boolean);
  },
};

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

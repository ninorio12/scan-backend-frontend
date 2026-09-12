/**
 * Adaptateur tRPC + serveurs HTTP classiques (Express, Fastify, Hono, NestJS).
 * Couvre les unités exposées quand le backend n'est ni Convex ni Next.js.
 */
export default {
  name: 'trpc-express',

  detect: ({ pkg }) =>
    !!pkg.dependencies?.['@trpc/server'] || !!pkg.dependencies?.express ||
    !!pkg.dependencies?.fastify || !!pkg.dependencies?.hono ||
    !!pkg.dependencies?.['@nestjs/common'],

  unitFiles: (f) => /\.(ts|js|mjs)$/.test(f.rel) && !/\.(test|spec)\./.test(f.rel),

  units(file) {
    const out = [];

    // tRPC : nom: publicProcedure.query(...) / protectedProcedure.mutation(...)
    for (const m of file.txt.matchAll(/(\w+)\s*:\s*(\w*[Pp]rocedure)\b([\s\S]{0,400}?)\.(query|mutation|subscription)\s*\(/g)) {
      const start = m.index;
      out.push({
        name: m[1], label: `trpc ${m[1]} (${m[4]})`, kind: 'trpc',
        exposure: /protected|private|auth|admin/i.test(m[2]) ? 'guarded' : 'public',
        line: file.txt.slice(0, start).split('\n').length,
        body: file.txt.slice(start, start + 900),
      });
    }

    // Express / Fastify / Hono : app.get("/x", …) router.post("/y", …)
    for (const m of file.txt.matchAll(/\b(?:app|router|server|api)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      const start = m.index;
      out.push({
        name: m[2], label: `${m[1].toUpperCase()} ${m[2]}`, kind: 'route', exposure: 'public',
        line: file.txt.slice(0, start).split('\n').length,
        body: file.txt.slice(start, start + 900),
        urlPath: m[2],
      });
    }

    // NestJS : @Get("x") au-dessus d'une méthode
    for (const m of file.txt.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*["'`]?([^"'`)]*)["'`]?\s*\)\s*\n\s*(?:async\s+)?(\w+)/g)) {
      const start = m.index;
      out.push({
        name: m[3], label: `${m[1].toUpperCase()} ${m[2] || '/'} (${m[3]})`, kind: 'route', exposure: 'public',
        line: file.txt.slice(0, start).split('\n').length,
        body: file.txt.slice(start, start + 900),
        urlPath: '/' + (m[2] || ''),
      });
    }

    return out;
  },

  refPatterns(u) {
    if (u.kind === 'trpc') return [new RegExp(`\\.${u.name}\\.(useQuery|useMutation|query|mutate|fetch)\\b`), new RegExp(`\\b${u.name}\\b`)];
    const p = String(u.urlPath || '').replace(/:[^/]+/g, '[^"\'`\\s]+').replace(/\//g, '\\/');
    return p ? [new RegExp(`["'\`]${p}(["'\`?/]|\\$)`)] : [new RegExp(`\\b${u.name}\\b`)];
  },

  entities: () => [],

  guardRe: /(protectedProcedure|isAuthed|requireAuth|requireUser|ensureAuth|authenticate|authorize|@UseGuards|passport|verifyToken|jwt|session\.|req\.user|apiKey|signature)/i,
  validatorRe: /(\.input\(|z\.object|zod|joi|yup|valibot|class-validator|@Body\(|schema)/,
};

# Ajouter une stack à l'auditeur

L'auditeur ne connaît aucune stack en dur. Il charge des **adaptateurs** depuis
`scripts/adapters/*.mjs`, en détecte automatiquement plusieurs à la fois, et applique
les mêmes règles à tous. Un nouveau SaaS sur une stack inconnue se couvre en un fichier.

```bash
node scripts/audit-backend.mjs <repo> --list-stacks   # ce qui est reconnu ici
```

## Adaptateurs livrés

| Adaptateur | Couvre | Apporte |
|---|---|---|
| `convex` | Convex | unités (query/mutation/action), tables `defineTable`, crons |
| `nextjs` | Next.js | route handlers `app/api/**/route.ts`, `pages/api`, Server Actions |
| `sql` | Prisma, Drizzle, Supabase, SQL brut | entités de données seules |
| `trpc-express` | tRPC, Express, Fastify, Hono, NestJS | procédures et routes HTTP |

Ils se combinent : un repo Next.js + Prisma active `nextjs` (les portes) et `sql`
(les tables), et les règles A, B, C s'appliquent à l'ensemble.

## Le contrat d'un adaptateur

Tout est optionnel sauf `name`, `detect`. Une règle dont l'adaptateur ne fournit pas
la brique est simplement sautée pour cette stack.

```js
export default {
  name: 'ma-stack',

  // Suis-je concerné par ce repo ? ({ pkg, exists, hasDir, files, read, glob })
  detect: ({ pkg }) => !!pkg.dependencies?.['ma-lib'],

  // ── Unités exposées (ce qui peut être appelé de l'extérieur) ──
  unitFiles: (f) => /^server\/.+\.ts$/.test(f.rel),
  units(file) {
    return [{
      name: 'creerLead',
      label: 'POST /leads',            // ce qu'on lit dans le rapport
      kind: 'route',                    // route | trpc | mutation | …
      exposure: 'public',               // public | internal | guarded | http
      line: 42,
      body: '…',                        // le corps, analysé par B1/B2/C4/C7
      urlPath: '/leads',                // si HTTP
    }];
  },
  // Comment un appel à cette unité s'écrit ailleurs dans le repo
  refPatterns: (u) => [new RegExp(`["'\`]${u.urlPath}["'\`?/]`)],

  // ── Entités de données ──
  entities: ({ read, exists, files, glob }) => [{ name: 'leads', source: 'db/schema.ts', fields: ['email'] }],
  readPatterns:  (t) => [new RegExp(`from\\(["'\`]${t}["'\`]`, 'g')],
  writePatterns: (t) => [new RegExp(`insert\\(["'\`]${t}["'\`]`, 'g')],

  // ── Briques des règles B et C ──
  guardRe: /requireUser|session|verifyToken/i,   // B1 : garde d'identité
  validatorRe: /z\.object|schema/,               // B2 : validation d'entrée
  internalOnlyLeakRe: null,                      // B3 : porte publique inutile
  writeCallRe: /db\.(insert|update)\s*\(/g,      // C2 : await manquant
  scanRe: null, scanBad: null,                   // C3 : lecture non bornée
  staleTimeKinds: /query/i,                      // C4 : temps dans une lecture réactive
  unboundedReadRe: null, unboundedOk: null,      // C6
  cronFile: null, cronRefRe: null,               // A4 : tâches planifiées
};
```

## Ce qui reste générique, quelle que soit la stack

Ces règles tournent sans adaptateur, sur tout code JS/TS du repo :

- **A5** variables d'environnement attendues par le code et absentes du `.env.example`
- **B4** secrets en dur
- **C1** pannes masquées par un catch muet
- **C3** (partie ORM) `findMany()` et `select('*')` sans filtre ni limite
- **C5** appels externes sans try/catch
- **C7** entrées rejouables sans idempotence

## Marche à suivre pour une nouvelle stack

1. `--list-stacks` sur le repo : peut-être qu'un adaptateur existant suffit déjà.
2. Copier l'adaptateur le plus proche, remplacer les expressions.
3. Vérifier sur un repo **réel**, pas sur un exemple : compter les faux positifs et les
   corriger avant de livrer l'adaptateur. Un détecteur qui crie au loup ne sera jamais
   relancé, et c'est pire que pas de détecteur du tout.
4. Vérifier la non-régression sur les repos déjà couverts.

## Limites connues, à ne pas maquiller

- Le câblage d'une route HTTP se prouve par la présence de son chemin dans le repo : on
  ne distingue pas le verbe. Un `GET /x` appelé quelque part dédouane le `POST /x` du
  même fichier.
- Un appel entièrement dynamique (chemin construit par concaténation, nom de fonction
  dans une variable) est invisible. D'où le mécanisme d'annotation.
- L'auditeur prouve que la chaîne est **reliée**, jamais que la donnée qui y circule est
  **juste**. Le smoke test en prod reste obligatoire.

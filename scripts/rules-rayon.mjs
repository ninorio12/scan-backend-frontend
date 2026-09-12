/**
 * AXE I — LE RAYON DE DESTRUCTION.
 *
 * Les autres axes cherchent des chaînes cassées dans le code applicatif. Celui-ci
 * cherche autre chose : de quoi un agent qui travaille seul dans ce dépôt est-il
 * CAPABLE s'il se trompe, et que reste-t-il après.
 *
 * L'enquête sur les incidents de production réellement causés par des agents de code
 * donne toujours la même triade, jamais un bug applicatif :
 *   1. un identifiant d'infrastructure trop large, que l'agent trouve tout seul en
 *      fouillant le dépôt (il n'a pas besoin de le voler, on l'a laissé là) ;
 *   2. une action destructrice sans garde mécanique (un drapeau qui supprime la
 *      confirmation, dans un script que n'importe quoi peut lancer) ;
 *   3. une sauvegarde stockée à l'intérieur de ce qu'elle protège, ou pas de
 *      sauvegarde du tout.
 * Les trois isolées sont vivables. Les trois ensemble, c'est la perte définitive :
 * un agent trouve la clé d'infrastructure dans le code, détruit un volume, et les
 * sauvegardes étaient dedans. Un `terraform destroy --auto-approve` déclenché sur un
 * état périmé : deux ans et demi de données. Un `drizzle-kit push --force` visant la
 * base de production : soixante tables, aucune restauration possible.
 *
 * D'où la règle de lecture de cet axe : un défaut ici ne se mesure pas à sa
 * probabilité, il se mesure à ce qu'il reste après. C'est le seul axe où « ça n'est
 * jamais arrivé » n'est pas un argument.
 *
 * PRÉCISION AVANT EXHAUSTIVITÉ. Un détecteur qui crie au loup n'est jamais relancé,
 * et un axe qu'on ne relance pas ne protège rien. Chaque règle ci-dessous préfère
 * rater un cas douteux plutôt que sortir un item que le lecteur devra réfuter. Les
 * exceptions sont écrites noir sur blanc à chaque fois, avec leur raison.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ─────────────────────────── Périmètre de lecture ──────────────────────────
   `files` (fourni par l'auditeur) ne contient que du code : .ts/.tsx/.js/.sql.
   Or tout cet axe vit AILLEURS — dans package.json, les workflows CI, les scripts
   shell, les fichiers d'environnement, le Terraform. Et le marcheur de l'auditeur
   saute les dossiers cachés, donc .github/workflows lui est invisible. On refait
   donc une passe, ciblée sur les fichiers d'infrastructure uniquement.
─────────────────────────────────────────────────────────────────────────── */

const DOSSIERS_MORTS = new Set([
  'node_modules', '_generated', '.next', '.git', 'dist', 'build', '.vercel',
  'coverage', '.turbo', 'out', '.output', 'vendor', '__pycache__', '.cache',
  '.venv', 'venv', '.pytest_cache', '.swc', '.parcel-cache', 'target',
]);

// Dossiers cachés qu'on veut malgré tout lire : c'est là que vit la CI.
const CACHES_UTILES = new Set([
  '.github', '.gitlab', '.circleci', '.claude', '.husky', '.devcontainer',
  '.config', '.buildkite', '.gitea', '.woodpecker',
]);

// Outillage tiers déposé dans le dépôt (spec-kit, skills, harnais de navigateur).
// Ce n'est pas notre infrastructure : ses scripts ne décrivent pas notre rayon de
// destruction, et les signaler noierait les vrais items. Vécu : un `TRUNCATED_SUFFIX`
// dans un script de spec-kit ressemble à un TRUNCATE SQL pour un détecteur naïf.
const OUTILLAGE_TIERS = /(^|\/)(\.specify|\.superpowers|\.agents|\.playwright-mcp|\.playwright|\.reticle|\.windsurf|\.cursor|\.opencode|public\/agentic-skills|\.claude\/(skills|worktrees|plugins)|\.husky\/_)(\/|$)/;

const TESTS = /(^|\/)(tests?|__tests__|__mocks__|e2e|tests-visuels|cypress|playwright-report|test-results)(\/|$)|\.(test|spec)\.[jt]sx?$/i;
const DOCUMENTATION = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const EXEMPLES = /\.(example|exemple|sample|template|dist|tpl|local\.example)(\.|$)|(^|\/)(examples?|exemples?|samples?|templates?|modeles?|fixtures?|__fixtures__|demos?|mocks?|seeds?)(\/|$)/i;
const VERROUS = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(b)?|composer\.lock|Cargo\.lock|poetry\.lock|skills-lock\.json)$/;
const LEGACY = /(^|\/)(_?legacy|archive|old|backup(s)?-old|deprecated)(\/|$)/i;

// Fichiers d'infrastructure : tout ce qui décrit COMMENT on déploie, migre, planifie.
const INFRA = new RegExp([
  '(^|/)(package\\.json|Makefile|makefile|GNUmakefile|Justfile|Taskfile\\.ya?ml)$',
  '(^|/)Dockerfile[^/]*$',
  '(^|/)docker-compose[^/]*\\.ya?ml$',
  '(^|/)(crontab|Procfile|vercel\\.json|convex\\.json|fly\\.toml|railway\\.json|render\\.ya?ml|netlify\\.toml|turbo\\.json|wrangler\\.toml|app\\.json)$',
  '\\.(ya?ml|sh|bash|zsh|fish|ps1|tf|tfvars|hcl|toml|sql|service|timer|cron|cnf|ini)$',
  '(^|/)\\.env($|\\.[\\w.-]+$)',
  // Tout fichier .json : c'est là que se posent les clés de service et les
  // politiques de permissions. Les fichiers de verrouillage et les gros exports
  // sont écartés plus bas, et les valeurs sont filtrées très strictement.
  '\\.json$',
].join('|'));

function marcher(racine) {
  const trouves = [];
  const descendre = (abs, rel) => {
    let entrees;
    try { entrees = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      if (DOSSIERS_MORTS.has(e.name)) continue;
      if (e.name.startsWith('.') && e.isDirectory() && !CACHES_UTILES.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { descendre(p, r); continue; }
      if (!INFRA.test(r) || VERROUS.test(r)) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.size > 400_000) continue; // un fichier d'infra fait quelques Ko ; au-delà c'est un export
      try { trouves.push({ rel: r, txt: fs.readFileSync(p, 'utf8') }); } catch { /* binaire ou illisible */ }
    }
  };
  descendre(racine, '');
  return trouves;
}

// Fichiers suivis par git. Sert à distinguer « un secret traîne sur ce disque »
// (ennuyeux) de « un secret est dans l'historique du dépôt » (irréversible : le
// retirer du HEAD ne le retire pas des clones ni des forks).
function fichiersSuivis(racine) {
  try {
    const sortie = execFileSync('git', ['-C', racine, 'ls-files', '-z'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(sortie.split('\0').filter(Boolean));
  } catch {
    return null; // pas un dépôt git, ou git absent : on ne devinera pas
  }
}

/* ──────────── Reconnaître une VRAIE valeur d'un renvoi à l'environnement ────────────
   C'est LE point qui décide de la crédibilité de la règle I2. Le dépôt est plein de
   chaînes qui ressemblent à des secrets et n'en sont pas : des hashs de lock, des
   UUID de maquette, des noms de variables, des exemples d'usage en commentaire.
   Une valeur n'est retenue que si elle ne peut être rien d'autre qu'un identifiant. */

const RENVOI = /process\.env|import\.meta\.env|Deno\.env|os\.environ|getenv|\$\{|\$\(|\$[A-Z_]|secrets\.|vars\.|vault|op:\/\/|\bENV\b/i;
const REMPLISSAGE = /^(?:x{3,}|\.{3,}|…|-+|_+|\*+|\?+)$|x{6,}|…|\.\.\.|<[^>]*>|\byour[-_ ]|\bmy[-_ ]|example|exemple|placeholder|changeme|change[-_]me|replace[-_ ]?(me|with)|dummy|fictif|redacted|masked|\bfake\b|\bsample\b|\btodo\b|\bhere\b|abcdefgh|1234567|aaaaaa|00000/i;

function vraieValeur(v) {
  const s = String(v).trim();
  if (s.length < 16 || s.length > 200) return false;   // trop court = pas un jeton ; trop long = un blob
  if (/\s/.test(s)) return false;                       // une phrase n'est pas un secret
  if (RENVOI.test(s)) return false;                     // renvoi à l'environnement : c'est la bonne pratique
  if (REMPLISSAGE.test(s)) return false;                // remplissage de documentation
  if (!/[0-9]/.test(s) || !/[A-Za-z]/.test(s)) return false; // un secret mêle lettres et chiffres
  if (/^(https?|wss?):\/\//.test(s) && !/:\/\/[^/\s:@]+:[^/\s@]+@/.test(s)) return false; // une URL sans identifiants n'est pas un secret
  if (/^[0-9a-f]{32,}$/i.test(s) && /hash|sha|md5|digest|etag|commit|sri/i.test(s)) return false;
  return true;
}

// Empreintes de fournisseurs : ces préfixes n'existent que sur de vrais jetons.
// Aucune d'elles n'a de variante « de test » qui traîne légitimement dans un dépôt.
const EMPREINTES = [
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/, 'clé API OpenAI/Anthropic'],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, 'clé secrète Stripe en mode live'],
  [/\bwhsec_[A-Za-z0-9]{16,}/, 'secret de webhook Stripe'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'jeton Slack'],
  [/\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'jeton GitHub'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clé d\'accès AWS'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'clé API Google'],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, 'clé SendGrid'],
  [/\bre_[A-Za-z0-9]{20,}/, 'clé Resend'],
  [/\bpit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'jeton d\'intégration GoHighLevel'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'jeton GitLab'],
  [/\bnpm_[A-Za-z0-9]{30,}/, 'jeton npm'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, 'clé privée'],
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^/\s:@]+:[^/\s@]{6,}@/, 'URL de base de données avec mot de passe'],
];

// Noms de champs qui annoncent un secret.
// Deux absences volontaires, chacune payée par un faux positif au premier essai :
// · « _URL » : NEXT_PUBLIC_CONVEX_URL est une adresse publique, pas un secret ;
// · « _KEY » tout court : STORAGE_KEY, RUNTIME_KEY, HIST_KEY, PHASE_KEY sont des
//   clés de localStorage. Le suffixe ne dit rien ; il faut API_KEY, SECRET_KEY,
//   ACCESS_KEY, DEPLOY_KEY ou PRIVATE_KEY pour que le nom annonce un identifiant.
const NOM_SECRET = /\b([A-Z][A-Z0-9_]*(?:API_?KEY|SECRET_KEY|ACCESS_KEY|DEPLOY_KEY|PRIVATE_KEY|TOKEN|SECRET|PASSWORD|PASSWD|_DSN|CREDENTIALS?)|api_?[Kk]ey|secret[Kk]ey|access[Tt]oken|auth[Tt]oken|client[Ss]ecret|password|passwd)\b\s*[:=]\s*["'`]([^"'`\n]{8,200})["'`]/g;

export default function reglesRayon({ files, lineAt, read, exists, root }) {
  const out = [];
  const infra = root ? marcher(root) : [];
  const suivis = root ? fichiersSuivis(root) : null;
  const estSuivi = (rel) => (suivis ? suivis.has(rel) : true); // sans git : on suppose versionné

  const propre = (rel) => !OUTILLAGE_TIERS.test(rel) && !TESTS.test(rel) && !LEGACY.test(rel) && !DOCUMENTATION.test(rel);
  const ligne = (txt, i) => lineAt(txt, i);

  /* ───────────────────────────────────────────────────────────────────────
     I1 · Drapeau destructeur câblé dans un script, une configuration, un
     package.json, un workflow CI ou une tâche planifiée.

     Le défaut n'est pas la destruction : parfois il FAUT réinitialiser une base.
     Le défaut est la suppression de la confirmation. `--auto-approve`,
     `--accept-data-loss`, `--force-reset` retirent la seule seconde pendant
     laquelle un humain aurait pu dire non. Une fois le drapeau écrit dans un
     script versionné, il s'exécute pour de bon : depuis la CI, depuis un cron,
     depuis un agent qui a juste cherché « comment déployer ici ».
     Facture connue : `terraform destroy --auto-approve` sur un état périmé, deux
     ans et demi de données ; `drizzle-kit push --force` sur la base de
     production, soixante tables.

     Exceptions écrites et assumées :
     · `--force` seul ne veut RIEN dire. `vercel --prod --force` ignore le cache de
       build, `npm install --force` résout un conflit de dépendances, `tsc --force`
       recompile. Le drapeau n'est retenu que si la commande de la ligne touche à
       de la donnée ou à de l'infrastructure (prisma, drizzle, terraform, kubectl,
       rm -rf, dropdb…). Sans ce garde-fou, la règle sortait trois faux positifs
       sur un seul dépôt et devenait inutilisable.
     · `destroy` idem : il faut un mot d'infrastructure sur la ligne, sinon on
       attrape `onDestroy`, `destroy()` d'une librairie, un nom de variable.
     · `TRUNCATE` doit être du SQL (`TRUNCATE TABLE …` ou `TRUNCATE x;`), sinon
       `TRUNCATED_SUFFIX` déclenche la règle. Vécu, en vrai, sur le premier essai.
     · Documentation, tests, exemples, outillage tiers : exclus.
  ─────────────────────────────────────────────────────────────────────── */
  {
    // Contexte « donnée ou infrastructure » : sans lui, --force et destroy sont muets.
    const CONTEXTE = /\b(prisma|drizzle(?:-kit)?|convex|supabase|sequelize|typeorm|knex|atlas|alembic|migrate|migration|db[:_ -]?(?:push|reset|drop|seed)|schema[:_ -]?(?:push|sync)|pg_dump|pg_restore|psql|dropdb|createdb|mysqldump|mysql|mongo(?:sh|dump|restore)?|redis-cli|flushall|flushdb|terraform|tofu|pulumi|cdk|serverless|sls|vagrant|kubectl|helm|k9s|docker\s+(?:volume|system|compose)|rm\s+-[a-z]*[rf]|wrangler|flyctl|planetscale|pscale|neon|firebase|gcloud|aws\s+s3|bucket|volume|cluster|namespace|database|schema)\b/i;

    const TOUJOURS = [
      [/--auto-approve\b/, 'application automatique sans revue (--auto-approve)'],
      [/(?<![\w-])-auto-approve\b/, 'application automatique sans revue (-auto-approve)'],
      [/--force-reset\b/, 'réinitialisation forcée du schéma (--force-reset)'],
      [/--accept-data-loss\b/, 'perte de données acceptée d\'avance (--accept-data-loss)'],
      [/--no-backup\b/, 'sauvegarde explicitement désactivée (--no-backup)'],
      [/--skip-(?:confirm|confirmation|prompt)\b/, 'confirmation supprimée (--skip-confirm)'],
      [/\bdrop\s+database\b/i, 'suppression d\'une base entière (DROP DATABASE)'],
      [/\btruncate\s+table\b/i, 'vidage de table (TRUNCATE TABLE)'],
      [/\bTRUNCATE\s+["'`]?\w+["'`]?\s*;/, 'vidage de table (TRUNCATE)'],
      [/\bflushall\b/i, 'vidage total du cache (FLUSHALL)'],
    ];
    const SOUS_CONTEXTE = [
      [/--force\b/, 'destruction forcée sans confirmation (--force)'],
      [/(?<![\w-])-f\b(?=[^\n]*\b(?:drop|reset|destroy|delete|purge)\b)/i, 'destruction forcée sans confirmation (-f)'],
      [/\bdestroy\b/i, 'destruction d\'infrastructure (destroy)'],
    ];

    const PROD = /\bprod\b|\bproduction\b|--prod\b|NODE_ENV\s*[:=]\s*["']?production|VERCEL_ENV\s*[:=]\s*["']?production|\bprd\b/i;

    const items = [];
    const bloquants = new Set();
    for (const f of infra) {
      if (!propre(f.rel) || EXEMPLES.test(f.rel)) continue;
      const lignes = f.txt.split('\n');
      for (let i = 0; i < lignes.length; i++) {
        const L = lignes[i];
        // Une ligne entièrement commentée dans un script décrit un usage, elle ne
        // s'exécute pas. On ne signale pas ce qui ne peut pas partir.
        if (/^\s*(#|\/\/|--|\*|<!--)/.test(L)) continue;
        const trouves = [];
        for (const [re, quoi] of TOUJOURS) if (re.test(L)) trouves.push(quoi);
        if (CONTEXTE.test(L)) for (const [re, quoi] of SOUS_CONTEXTE) if (re.test(L)) trouves.push(quoi);
        if (!trouves.length) continue;
        // Production : sur la ligne, dans son voisinage immédiat, ou dans le nom du fichier.
        const voisinage = lignes.slice(Math.max(0, i - 2), i + 3).join('\n');
        const versProd = PROD.test(voisinage) || PROD.test(f.rel);
        const item = `${f.rel}:${i + 1}  ${trouves.join(' + ')}${versProd ? ' — sur la PRODUCTION' : ''}  «${L.trim().slice(0, 90)}»`;
        items.push(item);
        if (versProd) bloquants.add(item);
      }
    }

    // Gravité de la règle entière : BLOQUANT dès qu'un seul de ces fichiers touche
    // à la production. Le reste est « à traiter » : la destruction est déjà
    // automatisée, seule la cible n'est pas encore la bonne, et c'est une variable
    // d'environnement qui l'en sépare.
    const gravite = bloquants.size ? 'BLOQUANT' : 'À TRAITER';
    // On montre d'abord ce qui vise la production.
    const ordonnes = [...items].sort((a, b) => (bloquants.has(b) ? 1 : 0) - (bloquants.has(a) ? 1 : 0));
    out.push(['I1', 'I', gravite, `Drapeaux destructeurs câblés dans un script ou une configuration (${ordonnes.length})`, ordonnes,
      "Un drapeau qui supprime la confirmation, dans un fichier versionné : c'est la seconde pendant laquelle un humain aurait pu dire non, retirée pour toujours. Ça ne se déclenche pas quand on regarde, ça se déclenche depuis la CI, depuis un cron, ou depuis un agent qui a juste cherché comment déployer ici.\nParade : la commande destructrice ne vit jamais dans un script exécutable. Elle est manuelle, elle demande le nom de l'environnement en toutes lettres, et l'identifiant qui la rend possible n'est pas lisible depuis le dépôt.\nFacture connue : terraform destroy --auto-approve sur un état périmé, deux ans et demi de données ; drizzle-kit push --force sur la base de production, soixante tables, aucune restauration."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     I2 · Jeton ou identifiant d'infrastructure lisible depuis le dépôt.

     Première branche de la triade, et la plus sous-estimée : dans les incidents
     réels, l'agent n'a jamais « volé » la clé. Il l'a trouvée en lisant le dépôt,
     exactement comme il lit tout le reste, et il s'en est servi parce qu'elle
     était là et qu'elle marchait. Un secret dans un fichier versionné n'est pas
     un secret : il est dans chaque clone, chaque fork, chaque cache d'agent, et
     le retirer du HEAD ne le retire de rien.

     Ce qui distingue une vraie valeur d'un renvoi à l'environnement :
     `process.env.X`, `${SECRET}`, `secrets.VERCEL_TOKEN`, `op://` sont la BONNE
     pratique et ne doivent jamais apparaître ici. Idem pour les remplissages de
     documentation (`your-token`, `sk-xxxx`, `<API_KEY>`, valeur tronquée par un
     `…`), pour les adresses publiques (`NEXT_PUBLIC_*_URL`), et pour les hashs.

     Exceptions écrites : .env.example et toute variante « exemple / sample /
     template », documentation, tests, fixtures, fichiers de verrouillage,
     outillage tiers. Un fichier .env non suivi par git n'est pas signalé comme
     versionné : il est signalé seulement si git le suit vraiment.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const items = [];
    const ENV_FICHIER = /(^|\/)\.env(\.[\w.-]+)?$/;

    // a) Un fichier d'environnement réellement suivi par git.
    for (const f of infra) {
      if (!ENV_FICHIER.test(f.rel) || EXEMPLES.test(f.rel) || !propre(f.rel)) continue;
      if (!suivis || !suivis.has(f.rel)) continue; // non versionné : hors sujet
      const secrets = [];
      for (const m of f.txt.matchAll(/^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*["']?([^\n"']*)["']?\s*$/gm)) {
        if (!vraieValeur(m[2]) && !EMPREINTES.some(([re]) => re.test(m[2]))) continue;
        secrets.push(m[1]);
      }
      if (!secrets.length) continue;
      items.push(`${f.rel}:1  fichier d'environnement suivi par git, ${secrets.length} valeur(s) réelle(s) : ${secrets.slice(0, 5).join(', ')}`);
    }

    // b) Une valeur d'identifiant écrite en dur dans un fichier versionné.
    const aFouiller = [...infra, ...files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.rel))];
    const vus = new Set();
    for (const f of aFouiller) {
      if (vus.has(f.rel)) continue;
      vus.add(f.rel);
      if (!propre(f.rel) || EXEMPLES.test(f.rel) || VERROUS.test(f.rel)) continue;
      if (!estSuivi(f.rel)) continue; // fichier local non versionné : il ne fuite pas avec le dépôt

      // Empreintes de fournisseurs : une seule suffit, le préfixe ne ment pas.
      for (const [re, quoi] of EMPREINTES) {
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
        for (const m of f.txt.matchAll(g)) {
          if (REMPLISSAGE.test(m[0])) continue;
          items.push(`${f.rel}:${ligne(f.txt, m.index)}  ${quoi} écrit en dur`);
        }
      }
      // Champ nommé « clé / jeton / secret » portant une valeur littérale crédible.
      for (const m of f.txt.matchAll(NOM_SECRET)) {
        if (!vraieValeur(m[2])) continue;
        items.push(`${f.rel}:${ligne(f.txt, m.index)}  ${m[1]} porte une valeur littérale (${m[2].slice(0, 6)}…)`);
      }
    }

    out.push(['I2', 'I', 'BLOQUANT', `Identifiants d'infrastructure lisibles depuis le dépôt (${items.length})`, items,
      "Dans les incidents réels, l'agent n'a jamais volé la clé : il l'a trouvée en lisant le dépôt, et il s'en est servi parce qu'elle marchait. Un identifiant versionné est dans chaque clone, chaque fork, chaque cache ; le retirer du HEAD ne le retire de nulle part.\nParade : la valeur ne vit que dans le coffre du déploiement, le code n'en connaît que le NOM. Et un identifiant trouvé dans le dépôt est réputé compromis : on le fait tourner, on ne le déplace pas.\nRègle de portée : une clé d'infrastructure (déploiement, cloud, base) ne devrait jamais pouvoir faire plus que ce dont le service a besoin. C'est la largeur de la clé qui transforme une erreur en incident."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     I3 · Aucune trace de sauvegarde ni de restauration, alors qu'il y a une base.

     Troisième branche de la triade, celle qui décide si l'incident est un
     incident ou une fin. Les deux premières branches sont des probabilités ; la
     sauvegarde est la seule chose qui change l'issue. Et elle échoue toujours de
     la même façon : personne ne l'a jamais écrite, ou elle vit à l'intérieur de
     ce qu'elle protège (dans le même dépôt, sur le même volume) et disparaît
     avec lui.

     Une seule entrée globale : dire « ce fichier ne sauvegarde pas » n'a aucun
     sens, l'absence est une propriété du projet.

     Ce qui compte comme preuve (volontairement généreux, pour ne jamais accuser à
     tort un projet qui sauvegarde autrement qu'on l'imagine) : un dossier de
     sauvegardes non vide, un script dont le nom parle de sauvegarde / export /
     dump / snapshot / restauration, un script npm, une tâche planifiée ou un
     workflow CI qui en parle, une option de rétention chez l'hébergeur.
     Ce qui ne compte PAS : la documentation (un plan n'est pas une sauvegarde),
     les captures de tests visuels (« -snapshots »), un fichier .backup égaré.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const items = [];
    const aBase = ['convex/schema.ts', 'prisma/schema.prisma', 'drizzle.config.ts', 'supabase/config.toml']
      .some((p) => exists && exists(p))
      || files.some((f) => /^(convex|prisma|drizzle|supabase|migrations)\//.test(f.rel))
      || files.some((f) => /\.(sql|prisma)$/.test(f.rel));

    if (aBase) {
      const MOT = /\b(backup|sauvegarde|pg_dump|pg_restore|mysqldump|mongodump|mongorestore|snapshot|restore|restaurer|restauration|point[- ]in[- ]time|pitr|retention)\b/i;
      const NOM_FICHIER = /(^|\/)[\w.-]*(backup|sauvegarde|dump|snapshot|restore|restaurer|export)[\w.-]*\.(sh|bash|mjs|cjs|js|ts|py|sql|ya?ml)$/i;
      const faux = (rel) => DOCUMENTATION.test(rel) || TESTS.test(rel) || OUTILLAGE_TIERS.test(rel) || /-snapshots?(\/|$)/i.test(rel);

      let preuve = null;
      // Un dossier de sauvegardes qui contient vraiment quelque chose.
      for (const d of ['backups', 'backup', 'sauvegardes', 'dumps', 'snapshots']) {
        try {
          const p = path.join(root || '.', d);
          if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length) { preuve = `dossier ${d}/`; break; }
        } catch { /* absent */ }
      }
      // Un script dédié.
      if (!preuve) {
        const tous = [...files, ...infra];
        const s = tous.find((f) => !faux(f.rel) && NOM_FICHIER.test(f.rel));
        if (s) preuve = s.rel;
      }
      // Un script npm, une tâche planifiée, un workflow CI, une option de rétention.
      if (!preuve) {
        const candidats = infra.filter((f) => !faux(f.rel)
          && /(^|\/)(package\.json|crontab|.*\.(ya?ml|tf|toml|sh))$/.test(f.rel));
        const s = candidats.find((f) => MOT.test(f.txt));
        if (s) preuve = s.rel;
      }
      // Une fonction de sauvegarde ou de restauration dans le code du backend.
      if (!preuve) {
        const s = files.find((f) => !faux(f.rel) && /^(convex|scripts|server|src\/server)\//.test(f.rel)
          && /\b(export const|function)\s+\w*(backup|sauvegarde|restore|restaurer|snapshot|dump)\w*/i.test(f.txt));
        if (s) preuve = s.rel;
      }

      if (!preuve) {
        items.push(`${path.basename(path.resolve(root || '.')) || 'projet'}  base de données présente, aucune sauvegarde, aucun export, aucune restauration nulle part dans le dépôt`);
      }
    }

    out.push(['I3', 'I', 'BLOQUANT', `Projet avec base de données et sans aucune trace de sauvegarde (${items.length})`, items,
      "Les deux autres branches de la triade sont des probabilités ; la sauvegarde est la seule chose qui décide si un incident est un incident ou une fin. Ici, rien : ni script, ni tâche planifiée, ni export, ni procédure de restauration.\nDeux pièges à traiter en même temps : une sauvegarde stockée à l'intérieur de ce qu'elle protège (même dépôt, même volume, même compte) disparaît avec lui ; et une sauvegarde jamais restaurée n'est pas une sauvegarde, c'est un fichier. La seule preuve est une restauration effectivement rejouée."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     I4 · Liste noire là où il faut une liste blanche.

     Une liste d'interdits est une liste de ce à quoi on a pensé. Elle est fausse
     le jour où quelqu'un écrit la même chose autrement : un alias, un chemin
     détourné, une variante d'orthographe, une commande équivalente. Une liste
     d'autorisations est fausse dans l'autre sens : elle refuse quelque chose de
     légitime, et quelqu'un s'en plaint tout de suite. C'est l'asymétrie qui
     compte : la première échoue en silence, la seconde échoue bruyamment.

     Deux formes détectées :
     a) une configuration de permissions qui énumère des `deny` sans jamais
        définir d'`allow` : tout ce qui n'a pas été prévu est permis ;
     b) un contrôle de code qui teste l'appartenance à une liste de commandes
        interdites.

     Exceptions : une liste nommée « FORBIDDEN_REPLACEMENTS » remplace du texte,
     ce n'est pas une garde de sécurité. La règle exige donc un nom qui parle de
     commandes, d'outils, de chemins ou d'actions, des littéraux de chaîne (et non
     des expressions régulières de substitution), et un usage en test d'appartenance.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const items = [];

    // a) Configuration de permissions : que des interdits.
    for (const f of infra) {
      if (!/\.json$/.test(f.rel) || !propre(f.rel) || EXEMPLES.test(f.rel)) continue;
      if (!/"permissions"/.test(f.txt) || !/"deny"/.test(f.txt)) continue;
      let cfg;
      try { cfg = JSON.parse(f.txt); } catch { continue; }
      const p = cfg && cfg.permissions;
      if (!p || !Array.isArray(p.deny) || !p.deny.length) continue;
      const allow = Array.isArray(p.allow) ? p.allow : [];
      if (allow.length) continue;
      const i = f.txt.indexOf('"deny"');
      items.push(`${f.rel}:${ligne(f.txt, i)}  ${p.deny.length} interdits énumérés, aucune autorisation définie : tout ce qui n'a pas été prévu passe`);
    }

    // b) Garde de code fondée sur une liste d'interdits.
    const NOM_LISTE = /(BLOCK(?:ED)?|BLACKLIST|DENY|DENIED|FORBIDDEN|BANNED|INTERDIT(?:S|ES)?|DANGEROUS|UNSAFE|REFUS(?:ES|E)?)[A-Z_]*(CMD|COMMANDS?|TOOLS?|BASH|SHELL|PATHS?|ROUTES?|ACTIONS?|OPS?|VERBS?|SCRIPTS?|HOSTS?|DOMAINS?|ORIGINS?|WORDS?|PATTERNS?)?/;
    const PORTE_SUR = /(CMD|COMMAND|TOOL|BASH|SHELL|PATH|ROUTE|ACTION|OP|VERB|SCRIPT|HOST|DOMAIN|ORIGIN|TABLE|MUTATION|ENDPOINT)/;
    for (const f of files) {
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(f.rel) || !propre(f.rel) || EXEMPLES.test(f.rel)) continue;
      // Un fichier qui définit AUSSI une liste blanche n'est pas le sujet.
      if (/\b(ALLOW(?:ED)?|WHITELIST|AUTORIS|PERMIS|SAFE)[A-Z_]*\s*(?::[^=\n]{0,80})?=\s*\[/.test(f.txt)) continue;
      for (const m of f.txt.matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]{4,})\s*(?::[^=\n]{0,100})?=\s*\[([\s\S]{0,600}?)\]/g)) {
        const nom = m[1];
        if (!NOM_LISTE.test(nom) || !PORTE_SUR.test(nom)) continue;
        const elements = [...m[2].matchAll(/["'`]([^"'`\n]{1,60})["'`]/g)].map((x) => x[1]);
        // Des littéraux de chaîne uniquement, et au moins trois : en dessous, ce
        // n'est pas une politique, c'est un cas particulier.
        if (elements.length < 3) continue;
        if (/\/[gimsuy]*\s*,|new RegExp/.test(m[2])) continue; // table de substitution, pas une garde
        // La liste doit servir de garde : test d'appartenance quelque part.
        const usage = new RegExp(`${nom}\\s*\\.\\s*(?:includes|some|indexOf|has|find)\\s*\\(|${nom}\\.some\\(`, 'm');
        if (!usage.test(f.txt)) continue;
        items.push(`${f.rel}:${ligne(f.txt, m.index)}  « ${nom} » énumère ${elements.length} cas interdits et sert de garde : tout le reste est autorisé par défaut`);
      }
    }

    out.push(['I4', 'I', 'À TRAITER', `Listes noires là où il faut une liste blanche (${items.length})`, items,
      "Une liste d'interdits est la liste de ce à quoi on a pensé. Elle tombe le jour où la même chose s'écrit autrement : un alias, un chemin détourné, une commande équivalente. L'asymétrie est là : une liste noire trop courte échoue en silence, une liste blanche trop courte échoue bruyamment et se corrige le jour même.\nParade : énumérer ce qui est PERMIS, refuser le reste par défaut, et faire en sorte que le refus soit visible."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     I5 · Séquence destructrice non transactionnelle : on vide, puis on remplit.

     Le motif qui efface quatre-vingt-dix jours d'historique : une synchronisation
     supprime l'existant avant d'écrire ce que vient de renvoyer une source
     externe. Le jour où la source répond une liste vide — panne, jeton expiré,
     filtre mal formé, quota — la suppression a lieu et l'écriture n'a rien à
     écrire. Le résultat a l'air d'une synchronisation réussie : aucune erreur,
     aucun log, juste une table vide.

     Détection : dans un même corps de fonction de SYNCHRONISATION, une suppression
     EN MASSE suivie d'une réécriture en boucle, sans garde préalable sur le vide.

     Exceptions écrites, chacune ajoutée après avoir lu un faux positif en vrai :
     · une garde de vide n'importe où avant la suppression (`if (!x.length) return`,
       `x.length === 0`, `if (clean.length === 0) return 0`) suffit à disculper,
       même si la variable gardée n'est pas celle qu'on supprime : l'intention de
       protection est là, c'est ce qu'on mesure. C'est exactement ce qui sépare
       `brain.replaceNotes` (protégée, après incident) de `recolte.replaceRecolte`
       (même code, garde absente) ;
     · la fonction doit être une synchronisation ou un remplacement venu d'une
       source qu'on ne maîtrise pas (nom ou fichier parlant de sync, ingest,
       import, capture, récolte, remplacement, mise à jour). Une mutation pilotée
       par un formulaire qui remplace les étiquettes d'une fiche envoie une liste
       vide parce que l'utilisateur a tout enlevé : c'est le comportement voulu,
       pas une perte. Sans cette condition la règle sortait quatre items par
       dépôt, tous à réfuter ;
     · l'écriture qui suit doit être une boucle ou une insertion en lot. Un
       `delete puis insert` d'UNE seule ligne est un upsert (`_upsertLoginCode`),
       pas un remplacement de jeu de données ;
     · les fonctions et fichiers de maintenance (seed, démo, migration, backfill,
       purge, cleanup, reset, dedup) : vider est leur travail, pas un accident ;
     · `clearTimeout`, `clearInterval`, l'opérateur `delete objet.champ`, et toute
       suppression d'UNE ligne par identifiant : ce n'est pas une suppression en
       masse ;
     · les composants d'interface (.tsx) : pas de base sous la main.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const items = [];
    const BACKEND = /^(convex|server|src\/server|scripts|app\/api|src\/app\/api|api|lib\/server|src\/lib\/server)\//;
    const MAINTENANCE = /^_?(seed|migrat|backfill|purge|clean|cleanup|nettoy|reset|dedup|reconcil|repair|fix|drop|vider|wipe|rollback|undo|test)/i;
    const FICHIER_MAINTENANCE = /(^|\/)[\w.-]*(seed|demo|migration|backfill|fixture|sandbox)[\w.-]*\.[jt]s$/i;
    // Le motif ne vaut que pour une reprise de données extérieure : c'est elle qui
    // peut répondre « rien » un mauvais jour, sans que personne l'ait demandé.
    const SYNCHRO = /sync|synchro|ingest|ingerer|import|refresh|rafraich|pull|capture|recolte|récolte|scrape|webhook|remplac|replace|\bmaj\b|mettreajour|reconstru|rebuild|hydrat|miroir|mirror/i;

    // Suppression en masse : une boucle sur un ensemble collecté, ou un appel qui
    // dit lui-même qu'il supprime tout.
    const EN_MASSE = [
      /for\s*\([^)]{0,160}\)[\s\S]{0,120}?ctx\.db\.delete\s*\(/,
      /\.map\s*\(\s*(?:async\s*)?\(?[\w{}, ]{0,40}\)?\s*=>[\s\S]{0,120}?ctx\.db\.delete\s*\(/,
      /\.deleteMany\s*\(/,
      /\bdelete\w*\s*\(\s*\{\s*where/,
      /\b(?:deleteAll|removeAll|clearAll|supprimerTout|viderTout|truncate)\w*\s*\(/i,
    ];
    // L'écriture doit porter sur un JEU de lignes : une boucle, une map, un lot.
    const ECRITURE_EN_LOT = [
      /for\s*\([^)]{0,160}\)[\s\S]{0,300}?(?:ctx\.db\.insert|\.insertMany|\.createMany|\b\w*(?:insert|upsert|save|write|batch)\w*)\s*\(/i,
      /\.map\s*\(\s*(?:async\s*)?\(?[\w{}, ]{0,40}\)?\s*=>[\s\S]{0,300}?(?:ctx\.db\.insert|\b\w*(?:insert|upsert|save|write|batch)\w*)\s*\(/i,
      /\.insertMany\s*\(|\.createMany\s*\(|\.bulkWrite\s*\(|\.createMany\s*\(/,
    ];
    const GARDE_VIDE = /!\s*[\w.[\]]+\.length|\.length\s*(?:===?|<)\s*(?:0|1)\b|\.length\s*>\s*0|isEmpty\s*\(|\bsi\s+vide\b/;

    for (const f of files) {
      if (!BACKEND.test(f.rel) || /\.tsx$/.test(f.rel)) continue;
      if (!propre(f.rel) || EXEMPLES.test(f.rel) || FICHIER_MAINTENANCE.test(f.rel)) continue;
      const bornes = [...f.txt.matchAll(/^(?:export\s+)?(?:const|async\s+function|function)\s+(\w+)/gm)];
      for (let i = 0; i < bornes.length; i++) {
        const nom = bornes[i][1];
        if (MAINTENANCE.test(nom)) continue;
        if (!SYNCHRO.test(nom) && !SYNCHRO.test(f.rel.split('/').pop())) continue;
        const debut = bornes[i].index;
        const fin = i + 1 < bornes.length ? bornes[i + 1].index : f.txt.length;
        const corps = f.txt.slice(debut, fin);
        if (corps.length > 20_000) continue; // ce n'est plus une fonction, c'est un module

        let iSupp = -1, motif = '';
        for (const re of EN_MASSE) {
          const m = corps.match(re);
          if (m && (iSupp === -1 || m.index < iSupp)) { iSupp = m.index; motif = m[0].replace(/\s+/g, ' ').slice(0, 50); }
        }
        if (iSupp === -1) continue;
        // L'ensemble supprimé doit venir d'une lecture : sans ça, ce n'est pas un
        // « on vide tout », c'est une suppression ciblée.
        if (!/\.collect\s*\(\)|\.findMany\s*\(|\.take\s*\(|\.select\s*\(/.test(corps.slice(0, iSupp + 200))) continue;
        const apres = corps.slice(iSupp);
        if (!ECRITURE_EN_LOT.some((re) => re.test(apres))) continue;
        if (GARDE_VIDE.test(corps.slice(0, iSupp))) continue; // protection présente : rien à dire
        items.push(`${f.rel}:${ligne(f.txt, debut)}  « ${nom} » supprime en masse (${motif}…) puis réécrit, sans garde sur une source vide`);
      }
    }

    out.push(['I5', 'I', 'BLOQUANT', `Séquences « on vide puis on remplit » sans garde sur le vide (${items.length})`, items,
      "Le jour où la source externe répond une liste vide (panne, jeton expiré, quota, filtre mal formé), la suppression a lieu et l'écriture n'a rien à écrire. Ça ne lève aucune erreur : la synchronisation a l'air d'avoir réussi, et la table est vide. C'est le motif qui efface quatre-vingt-dix jours d'historique.\nParade, dans cet ordre : refuser d'écrire si la source est vide ou anormalement petite ; réconcilier plutôt que remplacer (on n'efface que ce qui a vraiment disparu) ; et si le remplacement est indispensable, le faire dans une seule transaction."]);
  }

  // Déduplication finale : le même défaut trouvé par deux chemins reste UN défaut,
  // et un compteur qui gonfle fait douter de tout le rapport.
  return out.map(([id, axe, grav, titre, items, detail]) => {
    const uniques = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${uniques.length})`), uniques, detail];
  });
}

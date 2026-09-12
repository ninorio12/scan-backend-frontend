/**
 * AXE G — L'AUTHENTIFICATION QUI NE PROTÈGE RIEN.
 *
 * Ces règles viennent des consignes officielles que Convex écrit pour les agents
 * (`convex/_generated/ai/guidelines.md`, présent dans tout projet Convex). Elles y
 * figurent parce que ce sont des pièges vécus, et elles décrivent des pannes TOTALES
 * et SILENCIEUSES : le code appelle bien une garde, la garde s'exécute, et elle ne
 * protège rien du tout.
 *
 * C'est la pire catégorie de défaut de sécurité : il n'y a pas d'oubli visible à la
 * relecture. `ctx.auth.getUserIdentity()` est là, bien appelé, et il renvoie toujours
 * null parce qu'un fichier de configuration manque à l'autre bout du projet.
 */

export default function reglesAuth({ files, lineAt, exists, read, gardes, estGardee }) {
  const out = [];
  const code = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f.rel));
  const convex = code.filter((f) => /^convex\//.test(f.rel));
  const ui = code.filter((f) => /\.(tsx|jsx)$/.test(f.rel));

  /* ─── G1 · Des gardes d'identité sans fichier de configuration d'authentification.
     Règle officielle : « ALWAYS create convex/auth.config.ts when using authentication.
     Without it, ctx.auth.getUserIdentity() will always return null. »
     Conséquence : toutes les gardes du backend deviennent inopérantes d'un coup, sans
     la moindre erreur. Selon la façon dont chaque garde est écrite, le produit refuse
     tout le monde, ou laisse tout passer. ───────────────────────────────────────── */
  {
    const items = [];
    const utilisateurs = convex.filter((f) => /getUserIdentity|getAuthUserId/.test(f.txt));
    const configPresente = exists('convex/auth.config.ts') || exists('convex/auth.config.js');
    if (utilisateurs.length && !configPresente) {
      for (const f of utilisateurs.slice(0, 40)) {
        const m = f.txt.match(/getUserIdentity|getAuthUserId/);
        items.push(`${f.rel}:${lineAt(f.txt, f.txt.indexOf(m[0]))}  vérifie une identité qui sera toujours nulle`);
      }
      items.push(`→ ${utilisateurs.length} fichier(s) concerné(s) · convex/auth.config.ts est absent du projet`);
    }
    out.push(['G1', 'G', 'BLOQUANT', `Gardes d'identité sans configuration d'authentification (${items.length})`, items,
      "Sans convex/auth.config.ts, ctx.auth.getUserIdentity() renvoie TOUJOURS null. Toutes les gardes du backend deviennent inopérantes en même temps, sans une seule erreur visible : selon la façon dont chacune est écrite, le produit refuse tout le monde ou laisse tout passer.\nRègle officielle Convex. Si l'authentification n'est volontairement pas au programme, alors ces appels ne protègent rien et doivent être retirés plutôt que de faire croire à une garde."]);
  }

  /* ─── G2 · Le fournisseur client n'envoie pas les jetons.
     Règle officielle : « Do NOT use plain ConvexProvider when authentication is needed —
     it will not send tokens with requests. »
     Nuance apprise en auditant projet client B le 11/09/2026 : un ConvexProvider nu est parfaitement
     légitime sur une branche de mode démo, à condition qu'un provider authentifié existe
     ailleurs dans le même fichier. On ne signale donc que l'absence totale. ────────── */
  {
    const items = [];
    const auth = code.some((f) => /ConvexProviderWithClerk|ConvexProviderWithAuth|useConvexAuth/.test(f.txt));
    // Le signal n'est pas « le projet installe Clerk » mais « le backend réclame une
    // identité ». Un serveur qui appelle getUserIdentity derrière un client qui n'envoie
    // aucun jeton a des gardes mortes, quel que soit le fournisseur prévu plus tard.
    const attendUneIdentite = convex.some((f) => /getUserIdentity|getAuthUserId/.test(f.txt))
      || code.some((f) => /@clerk\/|ClerkProvider|NextAuth|auth0|supabase\.auth/.test(f.txt));
    if (attendUneIdentite && !auth) {
      for (const f of ui) {
        for (const m of f.txt.matchAll(/<ConvexProvider\b/g)) {
          items.push(`${f.rel}:${lineAt(f.txt, m.index)}  ConvexProvider nu alors que le projet a une authentification`);
        }
      }
    }
    out.push(['G2', 'G', 'BLOQUANT', `Jetons d'authentification jamais envoyés au backend (${items.length})`, items,
      "Le projet installe une authentification côté écran, mais le client Convex n'est pas celui qui transmet les jetons. Le visiteur est donc connecté à l'écran et anonyme pour le backend : chaque garde serveur voit une identité nulle.\nRègle officielle Convex. Un ConvexProvider nu reste légitime sur une branche de démonstration, tant qu'un provider authentifié existe par ailleurs."]);
  }

  /* ─── G3 · Un interrupteur d'authentification piloté par l'environnement.
     Une garde dont l'existence dépend d'une variable, et plus encore d'une variable
     publique, tombe le jour où cette variable est posée par erreur. ──────────────── */
  {
    const items = [];
    for (const f of code) {
      // if (DEMO_MODE) return next()  /  if (!secret) return  /  if (secret && x !== secret)
      // Seuls comptent les cas où l'absence de configuration OUVRE la porte.
      // « if (!CLE) return erreur » est un garde-fou correct, pas un défaut : on l'ignore.
      for (const m of f.txt.matchAll(/if\s*\(\s*(!?)\s*([A-Z_][A-Z0-9_]{3,}|process\.env\.[A-Z_][A-Z0-9_]*)\s*\)\s*(?:\{\s*)?return\s+(NextResponse\.next\(\)|next\(\)|true)\s*;?/g)) {
        const nom = m[2].replace('process.env.', '');
        const autour = f.txt.slice(Math.max(0, m.index - 400), m.index + 200);
        if (!/auth|clerk|session|identity|guard|protect|middleware|demo/i.test(autour)) continue;
        const publique = new RegExp(`NEXT_PUBLIC_\\w*${nom}|${nom}\\s*=\\s*process\\.env\\.NEXT_PUBLIC`).test(f.txt) || /^NEXT_PUBLIC/.test(nom);
        items.push(`${f.rel}:${lineAt(f.txt, m.index)}  la garde s'efface si « ${nom} »${publique ? ' (variable PUBLIQUE)' : ''} change`);
      }
      // if (secret && fourni !== secret) : la vérification disparaît quand le secret manque.
      // Restreint aux noms qui désignent VRAIMENT un secret : sinon on attrape toutes les
      // comparaisons métier optionnelles du repo, et le détecteur devient inutilisable.
      const SECRET = /secret|token|key|signature|hmac|password|bearer|auth|cron|webhook/i;
      for (const m of f.txt.matchAll(/if\s*\(\s*(\w+)\s*&&\s*[\w.()[\]"']+\s*!==\s*\1\s*\)/g)) {
        if (!SECRET.test(m[1])) continue;
        items.push(`${f.rel}:${lineAt(f.txt, m.index)}  vérification de « ${m[1]} » sautée si le secret n'est pas défini`);
      }
    }
    out.push(['G3', 'G', 'BLOQUANT', `Authentification qui s'efface selon l'environnement (${items.length})`, items,
      "Une garde dont l'existence dépend d'une variable d'environnement n'est pas une garde : c'est une garde par défaut d'inattention. Le jour où la variable manque, est mal orthographiée, ou est posée par erreur sur le mauvais déploiement, la porte s'ouvre en silence.\nUne variable NEXT_PUBLIC_ est encore pire : elle est visible et modifiable depuis le build.\nRègle : une vérification absente doit REFUSER, jamais laisser passer."]);
  }

  /* ═══ G4 à G7 · Les quatre formes du skill officiel convex-authz ═══════════════════
     Corpus mesuré par Convex sur des backends générés : 214 défauts confirmés, dont
     25 « identité reçue en argument », 13 « propriété jamais vérifiée », 6 « donnée
     sensible servie sur un identifiant fourni », plus la variante « écriture dans un
     conteneur qu'on ne possède pas ». On reprend les quatre formes telles quelles.

     Le trou que l'ancienne G4 manquait, vu sur un projet public inconnu : quatre
     fonctions publiques prenaient `userId: v.string()` en argument, sans un seul
     `ctx.auth` dans tout convex/. N'importe qui réécrivait le `stripeConnectId` d'un
     vendeur. L'ancienne règle exigeait en plus un mot de « décision de droit »
     (isAdmin, role…) : le trou n'en avait pas, il n'était nommé nulle part.

     LISTE NÉGATIVE, commune aux quatre formes (ce qu'on ne signale JAMAIS) :
     · une internalQuery / internalMutation / internalAction : elle n'est pas joignable
       de l'extérieur, l'identifiant reçu vient du serveur ;
     · une fonction dont le corps atteint une garde résolue par gardes.mjs (ctx.auth,
       ou n'importe quel helper qui y remonte) : l'identité est dérivée côté serveur, et
       l'argument n'est alors qu'un filtre (formes a et c) ;
     · une fonction dont le handler n'utilise pas l'argument (stub qui rend une
       constante) : rien à usurper ;
     · les chemins de maintenance et d'ingestion (seed, migration, backfill, import,
       sync, webhook) : serveur à serveur, c'est B1 qui juge leur exposition ;
     · `accountId` typé v.string() : c'est le plus souvent un compte EXTERNE (Meta
       `act_…`, Stripe `acct_…`), pas une identité. Il ne compte qu'en v.id(...).

     ET LA FONDATION D'AUTHENTIFICATION, étape 0 obligatoire du skill officiel : sans
     convex/auth.config.ts, ctx.auth.getUserIdentity() rend toujours null. Prescrire
     « ajouter une garde » à une application sans fondation fabrique un NOUVEAU défaut
     (toutes les portes refusent tout le monde). Le message dit alors : basculer en
     interne, ou installer l'authentification d'abord. Les formes b, c et d ne sont
     évaluées QUE si la fondation existe : sans elle, chaque porte est nue et B1 le
     dit déjà pour chacune ; répéter 200 lignes sous un autre numéro n'apprend rien. ═══ */
  {
    const fondation = exists('convex/auth.config.ts') || exists('convex/auth.config.js');
    // Pas « clientId » : dans un CRM, c'est la fiche d'un client, pas l'appelant (2 faux
    // positifs sur 2 au premier essai sur un dépôt réel). Pas « agentId » non plus : ce sont
    // des agents IA. Un nom n'entre ici que s'il désigne CELUI QUI APPELLE.
    const IDENT = /^(clerkUserId|clerkId|userId|authUserId|currentUserId|actorId|ownerId|authorId|sellerId|buyerId|memberId|creatorId|utilisateurId|proprietaireId|courtierId|coachId|coachClerkUserId|ownerClerkUserId|ownerUserId|userEmail|orgId|tenantId|accountId)$/;
    const MAINTENANCE = /^(seed|migr|backfill|import|sync|ingest|webhook|purge|cleanup|nettoy|reset)/i;
    // La liste du skill officiel (email, revenue, ssn, password, token, journal d'audit),
    // plus les identifiants de paiement. PAS « price / montant / adresse » : le prix d'un
    // événement public ou l'adresse d'un bien en vitrine ne sont pas des données de
    // personne, et les compter fabriquait des faux positifs sur un catalogue public.
    const SENSIBLE = /\b(email|courriel|phone|telephone|mobile|password|motDePasse|passwordHash|token|accessToken|refreshToken|secret|iban|ssn|revenue|chiffreAffaires|salary|salaire|auditLog|stripeConnectId|stripeCustomerId|stripeAccountId|apiKey)\b/i;

    // Les champs déclarés par table, pour savoir ce qu'un `return doc` expose (forme c).
    const champsParTable = new Map();
    if (exists('convex/schema.ts')) {
      const schema = read('convex/schema.ts');
      for (const t of schema.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable\(\{([\s\S]*?)^\s{2}\}\)/gm)) {
        champsParTable.set(t[1], [...t[2].matchAll(/^\s{4}(\w+)\s*:/gm)].map((x) => x[1]));
      }
    }

    // Les fonctions publiques de convex/, avec leurs arguments typés.
    const fonctions = [];
    for (const f of convex) {
      if (/schema\.ts$|\.test\.ts$|_generated/.test(f.rel)) continue;
      const re = /export const (\w+)\s*=\s*(query|mutation|action)\s*\(\s*\{/g;
      let m;
      while ((m = re.exec(f.txt))) {
        const suite = f.txt.indexOf('\nexport const', m.index + 10);
        const corps = f.txt.slice(m.index, suite === -1 ? f.txt.length : suite);
        const iArgs = corps.search(/\bargs\s*:\s*\{/);
        const iHandler = corps.search(/\bhandler\s*:/);
        const entete = iArgs === -1 ? '' : corps.slice(iArgs, iHandler === -1 ? corps.length : iHandler);
        const handler = iHandler === -1 ? corps : corps.slice(iHandler);
        const args = [];
        for (const a of entete.matchAll(/(\w+)\s*:\s*v\.(?:optional\(\s*v\.)?(id|string|number|boolean|union|object|array|any|literal)\(\s*(?:["'`](\w+)["'`])?/g)) {
          args.push({ nom: a[1], type: a[2], table: a[3] || null });
        }
        const garde = /getUserIdentity|getAuthUserId|\bctx\s*\.\s*auth\b/.test(corps) || (estGardee ? estGardee(corps, gardes || new Set()) : null);
        fonctions.push({ nom: m[1], kind: m[2], fichier: f.rel, ligne: lineAt(f.txt, m.index), corps, entete, handler, args, garde });
      }
    }

    const lieu = (fn) => `${fn.fichier}:${fn.ligne}  ${fn.nom}`;

    /* ─── G4 · forme (a) : l'identité reçue en argument, jamais dérivée du jeton. ─── */
    {
      const items = [];
      for (const fn of fonctions) {
        if (fn.garde) continue;
        if (MAINTENANCE.test(fn.nom)) continue;
        const ident = fn.args.find((a) => IDENT.test(a.nom) && (a.type === 'id' || a.type === 'string') && !(a.nom === 'accountId' && a.type !== 'id'));
        if (!ident) continue;
        // Le handler lit-il vraiment cet argument ? Sinon il n'y a rien à usurper.
        const lu = new RegExp(`\\b${ident.nom}\\b`).test(fn.handler);
        if (!lu) continue;
        const ecrit = /ctx\.db\.(insert|patch|replace|delete)\s*\(/.test(fn.handler);
        items.push(`${lieu(fn)}  reçoit « ${ident.nom} » en argument, aucun ctx.auth : l'appelant dit qui il est${ecrit ? ' et la fonction ÉCRIT en son nom' : ' et la fonction lit en son nom'}${fondation ? '' : ' · pas de fondation d\'authentification : basculer en interne, pas ajouter une garde'}`);
      }
      out.push(['G4', 'G', 'BLOQUANT', `Identité fournie par l'appelant, jamais vérifiée (${items.length})`, items,
        (fondation
          ? "L'appelant choisit qui il est : il passe l'identifiant d'un autre utilisateur et lit ou réécrit ses données. La fonction est typée, validée, et ouverte.\nRègle officielle Convex, en majuscules : ne JAMAIS accepter un identifiant d'utilisateur en argument à des fins d'autorisation. Correction : retirer l'argument, dériver l'identité de ctx.auth.getUserIdentity() dans le handler (ou un helper requireIdentity partagé), et comparer au sujet du jeton."
          : "L'appelant choisit qui il est : il passe l'identifiant d'un autre utilisateur et lit ou réécrit ses données.\n⚠ Cette application n'a PAS de fondation d'authentification (convex/auth.config.ts absent) : ctx.auth.getUserIdentity() y rendrait toujours null, et ajouter une garde ferait refuser tout le monde. Ne pas prescrire de garde. Correction : basculer ces fonctions en internalQuery / internalMutation et ne les appeler que depuis le serveur, ou installer l'authentification d'abord puis relancer cet audit.")]);
    }

    /* ─── G5 · forme (b) : la ligne est chargée par son identifiant, modifiée ou rendue,
       sans que personne vérifie qu'elle appartient à l'appelant. Être connecté n'est
       pas posséder cette ligne. Évaluée seulement avec fondation et sur une fonction
       déjà gardée (sinon c'est B1). ─── */
    {
      const items = [];
      const COMPARAISON = /(?:===|!==|==|!=)\s*[\w.]*(?:identity|subject|tokenIdentifier|user|owner|auteur|proprietaire|courtier|coach|org|tenant|clerk|membre|member|createdBy|actor)|(?:identity|subject|tokenIdentifier|user|owner|auteur|proprietaire|courtier|coach|org|tenant|clerk|membre|member|createdBy|actor)[\w.]*\s*(?:===|!==|==|!=)|\.(?:includes|has)\s*\(\s*[\w.]*(?:user|identity|subject|clerk|membre|member)/i;
      const HELPER_PROPRIETE = /\b\w*(?:owner|own|acces|access|appartient|belong|peut|can[A-Z]|allowed|member|membre|role|admin|scope|assert|ensure|check|verif|require)\w*\s*\(/g;
      for (const fn of fonctions) {
        if (!fondation || !fn.garde) continue;
        if (MAINTENANCE.test(fn.nom)) continue;
        const ids = fn.args.filter((a) => a.type === 'id');
        if (!ids.length) continue;
        for (const a of ids) {
          const charge = new RegExp(`ctx\\.db\\.get\\(\\s*(?:args\\.)?${a.nom}\\s*\\)`).test(fn.handler);
          if (!charge) continue;
          const modifie = new RegExp(`ctx\\.db\\.(patch|delete|replace)\\(\\s*(?:args\\.)?${a.nom}\\b`).test(fn.handler);
          const rendTelQuel = new RegExp(`return\\s+(?:await\\s+)?ctx\\.db\\.get\\(\\s*(?:args\\.)?${a.nom}\\s*\\)`).test(fn.handler);
          if (!modifie && !rendTelQuel) continue;
          if (COMPARAISON.test(fn.handler)) continue;
          // Une porte réservée à un rôle (requireAdmin, reserveAuxFondateurs, hasSuperAdminPowers…)
          // touche légitimement n'importe quelle ligne ; une porte serveur-à-serveur
          // (…FromServer, …ForServer, gardée par un secret) n'a pas d'appelant à qui comparer.
          if (/\b\w*(?:admin|founder|fondateur|staff|super)\w*\s*\(/i.test(fn.handler)) continue;
          if (/(FromServer|ForServer|Interne|Internal)$/.test(fn.nom) || /process\.env\.\w*(SECRET|TOKEN|KEY)/.test(fn.corps)) continue;
          const helpers = [...fn.handler.matchAll(HELPER_PROPRIETE)].map((h) => h[0]);
          // Une porte réservée à un rôle (requireAdmin, assertStaff…) touche légitimement
          // n'importe quelle ligne : ce n'est pas un défaut de propriété, c'est son métier.
          if (helpers.some((h) => /admin|staff|role|super|owner|proprietaire|founder|fondateur/i.test(h))) continue;
          // Un second helper, au-delà de la garde d'identité, est présumé vérifier la propriété.
          if (helpers.length > 1) continue;
          items.push(`${lieu(fn)}  charge « ${a.nom} », ${modifie ? 'la modifie' : 'la rend telle quelle'}, sans comparer son propriétaire à l'identité`);
        }
      }
      out.push(['G5', 'G', 'BLOQUANT', `Lignes modifiées ou rendues sans vérification de propriété (${items.length})`, items,
        "La fonction vérifie que l'appelant est connecté, puis charge une ligne par l'identifiant qu'il fournit et la modifie ou la rend. Être connecté n'est pas posséder cette ligne : tout utilisateur atteint celles des autres en devinant ou en énumérant les identifiants.\nCorrection : après ctx.db.get, comparer le champ propriétaire de la ligne au sujet du jeton (requireOwner), avant de toucher ou de rendre quoi que ce soit.\nNon évaluée sans fondation d'authentification : là, B1 juge chaque porte."]);
    }

    /* ─── G6 · forme (c) : une query publique, paramétrée par un identifiant fourni,
       rend des champs sensibles sans aucune garde. Évaluée seulement avec fondation
       (sans elle, B1 dit déjà que chaque porte est nue). ─── */
    {
      const items = [];
      for (const fn of fonctions) {
        if (!fondation || fn.garde || fn.kind !== 'query') continue;
        if (MAINTENANCE.test(fn.nom)) continue;
        const cle = fn.args.find((a) => a.type === 'id' || /Id$/.test(a.nom));
        if (!cle) continue;
        // Champs sensibles : nommés dans le handler, ou portés par la table rendue telle quelle.
        let expose = (fn.handler.match(SENSIBLE) || [])[0] || null;
        if (!expose) {
          const tables = [...fn.handler.matchAll(/\.query\(\s*["'`](\w+)["'`]\s*\)/g)].map((x) => x[1]);
          if (cle.table) tables.push(cle.table);
          const rendTelQuel = /return\s+(?:await\s+)?(?:ctx\.db\.get\(|\w+\s*;|\w+\s*$)/m.test(fn.handler) || /\.collect\(\)\s*;?\s*\n?\s*(?:return|\})/.test(fn.handler);
          if (rendTelQuel) for (const t of tables) {
            const s = (champsParTable.get(t) || []).find((c) => SENSIBLE.test(c));
            if (s) { expose = `${t}.${s}`; break; }
          }
        }
        if (!expose) continue;
        items.push(`${lieu(fn)}  rend « ${expose} » sur un « ${cle.nom} » fourni par l'appelant, sans garde`);
      }
      out.push(['G6', 'G', 'BLOQUANT', `Données sensibles servies sur un identifiant fourni, sans garde (${items.length})`, items,
        "Une query publique, un identifiant en argument, une réponse qui contient un email, un montant, un téléphone ou un jeton : n'importe qui, connecté ou non, énumère les identifiants et lit les données des autres.\nCorrection : requireIdentity avant toute lecture hors du périmètre de l'appelant, puis comparer l'identifiant demandé au sujet du jeton (ou à un rôle explicite).\nNon évaluée sans fondation d'authentification : là, B1 juge chaque porte."]);
    }

    /* ─── G7 · forme (d) : une mutation publique écrit une ligne enfant dans un conteneur
       (projet, équipe, organisation, dossier, conversation…) désigné par un v.id reçu en
       argument, sans vérifier que l'appelant possède ce conteneur. Corriger QUI appelle
       (forme a) ne corrige pas OÙ il a le droit d'écrire. Évaluée seulement avec fondation
       et sur une fonction gardée. ─── */
    {
      const items = [];
      for (const fn of fonctions) {
        if (!fondation || !fn.garde || fn.kind !== 'mutation') continue;
        if (MAINTENANCE.test(fn.nom)) continue;
        if (/(FromServer|ForServer|Interne|Internal)$/.test(fn.nom) || /process\.env\.\w*(SECRET|TOKEN|KEY)/.test(fn.corps)) continue;
        for (const a of fn.args.filter((x) => x.type === 'id')) {
          // Un conteneur n'a de propriété à vérifier que si sa table déclare un propriétaire
          // (clerkUserId, ownerClerkUserId, orgId…). Un catalogue partagé (vidéos de
          // formation, offres publiques) n'appartient à personne : y référencer une ligne
          // n'usurpe rien. Vécu : « marquerIntroVue écrit sous videoId » sur un catalogue.
          const champsParent = a.table ? (champsParTable.get(a.table) || []) : [];
          if (!champsParent.some((c) => /(ClerkUserId|ClerkId|clerkUserId|clerkId)$|^(orgId|organizationId|workspaceId|tenantId|accountId|companyId|teamId|ownerId|ownerUserId|userId|coachId|proprietaireId|courtierId)$/.test(c))) continue;
          // L'identifiant sert de clé étrangère : il est la VALEUR d'un champ dans l'objet
          // écrit (`{ projectId: args.projectId }`). Patcher la ligne désignée par cet
          // identifiant n'est pas « écrire dans un conteneur », c'est la forme (b) ; sans
          // cette distinction, chaque `patch(args.id, …)` sortait ici. Vécu sur un dépôt réel.
          const cleEtrangere = new RegExp(`ctx\\.db\\.(?:insert|patch|replace)\\([^;]{0,600}?\\b\\w+\\s*:\\s*(?:args\\.)?${a.nom}\\b`).test(fn.handler)
            && !new RegExp(`ctx\\.db\\.(?:patch|replace)\\(\\s*(?:args\\.)?${a.nom}\\s*,`).test(fn.handler);
          if (!cleEtrangere) continue;
          // Le conteneur est chargé et comparé, ou confié à un helper qui le reçoit.
          const charge = new RegExp(`ctx\\.db\\.get\\(\\s*(?:args\\.)?${a.nom}\\s*\\)`).test(fn.handler);
          const confie = new RegExp(`\\b\\w*(?:owner|own|acces|access|appartient|belong|peut|can[A-Z]|allowed|member|membre|role|admin|scope|assert|ensure|check|verif|require)\\w*\\s*\\([^)]*\\b(?:args\\.)?${a.nom}\\b`).test(fn.handler);
          // Une porte réservée à un rôle (admin, fondateur, staff) écrit légitimement dans
          // n'importe quel conteneur : c'est son métier, pas un défaut de propriété.
          if (/\b\w*(?:admin|founder|fondateur|staff|super)\w*\s*\(/i.test(fn.handler)) continue;
          const compare = /(?:===|!==|==|!=)\s*[\w.]*(?:identity|subject|tokenIdentifier|user|owner|auteur|proprietaire|courtier|coach|org|tenant|clerk|membre|member|createdBy)|(?:identity|subject|tokenIdentifier|user|owner|auteur|proprietaire|courtier|coach|org|tenant|clerk|membre|member|createdBy)[\w.]*\s*(?:===|!==|==|!=)|\.(?:includes|has)\s*\(/i.test(fn.handler);
          if (confie || (charge && compare)) continue;
          // Sans chargement du conteneur ni comparaison : le parent n'est jamais regardé.
          if (!charge && !compare) {
            items.push(`${lieu(fn)}  écrit sous « ${a.nom} » (${a.table || 'table ?'}) sans vérifier que l'appelant possède ce conteneur`);
          }
        }
      }
      out.push(['G7', 'G', 'BLOQUANT', `Écritures dans un conteneur dont la propriété n'est pas vérifiée (${items.length})`, items,
        "L'appelant est connecté, mais il désigne le projet, l'équipe ou le dossier de quelqu'un d'autre par son identifiant, et la mutation y crée ou y déplace une ligne. Créer une ligne dans le conteneur d'autrui est le même défaut que modifier sa ligne, et il survit à la correction de la forme « identité en argument ».\nCorrection : charger le conteneur référencé et appliquer requireOwner (ou le contrôle d'appartenance du schéma) AVANT l'insertion.\nNon évaluée sans fondation d'authentification : là, B1 juge chaque porte."]);
    }
  }

  return out.map(([id, axe, grav, titre, items, detail]) => {
    const u = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${u.length})`), u, detail];
  });
}

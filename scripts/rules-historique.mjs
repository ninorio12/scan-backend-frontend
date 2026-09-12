/**
 * AXE E — LES PIÈGES QU'ON A DÉJÀ PAYÉS.
 *
 * Chaque règle ici vient d'un incident réel sur un de nos SaaS, retrouvé dans les notes
 * de session. Ce ne sont pas des bonnes pratiques de manuel : ce sont des factures.
 *
 * La logique de cet axe : un défaut qui nous a coûté une fois nous recoûtera, parce que
 * la session suivante ne se souvient de rien. La seule mémoire fiable est un détecteur.
 */

// La chaîne d'une requête, du .query() jusqu'à la fin de l'instruction. Une fenêtre
// de N caractères attrape le filtre de la fonction suivante et rend le détecteur muet.
function chaineDeRequete(txt, debut) {
  let prof = 0;
  for (let k = debut; k < Math.min(txt.length, debut + 2000); k++) {
    const c = txt[k];
    if (c === '(' || c === '{' || c === '[') prof++;
    else if (c === ')' || c === '}' || c === ']') prof--;
    else if (c === ';' && prof <= 0) return txt.slice(debut, k);
  }
  return txt.slice(debut, debut + 600);
}

// Un chemin de maintenance lit légitimement toute la table. On le reconnaît au NOM de
// la fonction englobante, jamais à son voisinage : « export » est le mot-clé qui précède
// chaque fonction d'un module, et le chercher dans les 400 caractères précédents éteint
// le détecteur sur la totalité du fichier. Bug vécu, trouvé par le test des détecteurs.
const MAINTENANCE = /^(migrat|purge|seed|backfill|cleanup|nettoy|exporter|dedup|reconcil|repair|fix)/i;
function estMaintenance(txt, index) {
  const avant = txt.slice(0, index);
  const decl = avant.lastIndexOf('export const ');
  const fn = avant.lastIndexOf('function ');
  const debut = Math.max(decl === -1 ? -1 : decl + 13, fn === -1 ? -1 : fn + 9);
  if (debut <= 0) return false;
  const nom = (txt.slice(debut, debut + 60).match(/^\w+/) || [''])[0];
  return MAINTENANCE.test(nom) || /^(convex\/)?(seed|migrations?|scripts)\//.test('');
}


// Les énumérations d'un bloc de table, par PARENTHÉSAGE ÉQUILIBRÉ : `status: v.union(`
// s'étale presque toujours sur plusieurs lignes, et une expression régulière qui s'arrête
// à la première parenthèse fermante ne voyait que le premier littéral (donc « pas une
// énumération »). Mesuré : les vocabulaires multi-lignes étaient invisibles à E2 et E4.
// Rend Map(champ → [valeurs]) pour les champs `v.union(...)` / `v.optional(v.union(...))`
// dont au moins deux membres sont des v.literal("…").
function unionsDuBloc(bloc) {
  const out = new Map();
  for (const m of bloc.matchAll(/^\s{4}(\w+)\s*:\s*(?:v\.optional\(\s*)?v\.union\(/gm)) {
    const debut = m.index + m[0].length;
    let prof = 1, k = debut;
    while (k < bloc.length && prof > 0) { if (bloc[k] === '(') prof++; else if (bloc[k] === ')') prof--; k++; }
    const corps = bloc.slice(debut, k - 1);
    // Jusqu'au même guillemet que l'ouvrant : « Aujourd'hui » est une valeur, pas deux.
    const vals = [...corps.matchAll(/v\.literal\(\s*(["'`])((?:(?!\1)[^\n])+)\1\s*\)/g)].map((x) => x[2]);
    if (vals.length >= 2) out.set(m[1], vals);
  }
  return out;
}


// Distance d'édition, bornée : sert à reconnaître une quasi-valeur (« gagnee » / « gagne »).
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export default function reglesHistorique({ files, lineAt, convexDir, read, exists }) {
  const out = [];
  const code = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f.rel));
  const backend = code.filter((f) => /^convex\//.test(f.rel) || /\/(server|api)\//.test(f.rel));

  /* ───────────────────────────────────────────────────────────────────────
     E1 · Tâche planifiée qui vise une fonction protégée par une garde d'identité.
     Incident Bold Shift, 27/07/2026 : le cron iClosed « syncRecent » appelait une
     mutation gardée par requireAdmin. Il n'y a AUCUNE identité dans le contexte d'un
     cron : la garde refuse, à chaque passage, et personne ne le voit. La donnée a
     simplement cessé d'arriver.
     Parade connue : extraire le cœur en helper sans garde ; la mutation publique garde
     l'auth puis appelle le cœur ; les chemins internes appellent le cœur directement.
  ─────────────────────────────────────────────────────────────────────── */
  {
    // Une garde ne se reconnaît pas à une liste de noms : le banc d'essai en a planté
    // une nommée « requireCourtier » et le détecteur est resté muet. On reconnaît donc
    // la FORME (require*/assert*/ensure*/check*) et on résout les helpers qui appellent
    // vraiment ctx.auth, quel que soit leur nom.
    const GARDE = /\b(require|assert|ensure|check|guard|verif)[A-Z]\w*\s*\(|getUserIdentity|getAuthUserId/;
    // Table des fonctions backend et de leur corps.
    const fns = new Map();
    for (const f of backend) {
      const re = /export const (\w+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*\(/g;
      let m;
      while ((m = re.exec(f.txt))) {
        const suite = f.txt.indexOf('\nexport const', m.index + 10);
        const mod = f.rel.replace(/^convex\//, '').replace(/\.ts$/, '');
        fns.set(`${mod}.${m[1]}`, {
          corps: f.txt.slice(m.index, suite === -1 ? f.txt.length : suite),
          fichier: f.rel, ligne: lineAt(f.txt, m.index), kind: m[2],
        });
      }
    }

    const pieges = [];
    const cibles = [];
    // Cibles déclarées dans crons.ts
    for (const nom of ['convex/crons.ts', 'convex/cron.ts']) {
      const f = files.find((x) => x.rel === nom);
      if (!f) continue;
      for (const m of f.txt.matchAll(/(api|internal)\.([\w.]+)\.(\w+)/g)) {
        cibles.push({ ref: `${m[2]}.${m[3]}`, depuis: `${nom}:${lineAt(f.txt, m.index)}`, quoi: 'cron' });
      }
    }
    // Cibles programmées par le scheduler
    for (const f of backend) {
      for (const m of f.txt.matchAll(/scheduler\.run(?:After|At)\s*\([^,]+,\s*(api|internal)\.([\w.]+)\.(\w+)/g)) {
        cibles.push({ ref: `${m[2]}.${m[3]}`, depuis: `${f.rel}:${lineAt(f.txt, m.index)}`, quoi: 'scheduler' });
      }
    }

    for (const c of cibles) {
      const fn = fns.get(c.ref);
      if (!fn) continue;                    // cible absente : c'est la règle A4
      if (!GARDE.test(fn.corps)) continue;  // pas de garde : rien à signaler
      // Une garde par secret partagé passé en argument reste viable dans un cron.
      if (/args\s*\.\s*secret|INTERNAL_API_SECRET|apiKey|token/.test(fn.corps) && !/getUserIdentity|getAuthUserId/.test(fn.corps)) continue;
      pieges.push(`${c.depuis} → ${c.ref} (${fn.fichier}:${fn.ligne}) protégée par une garde d'identité`);
    }

    out.push(['E1', 'E', 'BLOQUANT', `Tâches planifiées vouées à échouer sur l'authentification (${pieges.length})`, pieges,
      "Un cron n'a pas d'identité : une fonction gardée par requireAdmin ou getUserIdentity refusera à chaque passage, silencieusement, et la donnée cessera simplement d'arriver.\nParade : extraire le cœur en helper sans garde ; la mutation publique garde l'auth puis appelle ce cœur ; les chemins internes l'appellent directement.\nIncident fondateur : cron iClosed, Bold Shift, 27/07/2026."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     E2 · Table partagée lue sans son discriminant.
     Incident client D, 04-05/09/2026 : « crm_leads » contenait les distilleries ET une
     fiche technique par contact, séparées par « estDistillerie ». Des écrans lisaient
     la table entière et affichaient un membre du club comme une distillerie. 39 lecteurs,
     5 vrais défauts. Un filtre sans rapport masquait le bug ailleurs.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const manques = [], pollues = [];
    if (exists && exists('convex/schema.ts')) {
      const schema = read('convex/schema.ts');
      // Tables et leurs champs discriminants : booléen « estX/isX », ou petit enum.
      for (const t of schema.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable\(\{([\s\S]*?)^\s{2}\}\)/gm)) {
        const table = t[1], bloc = t[2];
        const discriminants = [], marqueursTest = [];
        for (const c of bloc.matchAll(/^\s{4}(\w+)\s*:\s*(?:v\.optional\()?v\.boolean\(\)/gm)) {
          // Un marqueur de démo n'est pas un discriminant de type : le lire sans filtrer
          // ne montre pas la mauvaise sorte d'objet, il compte du faux dans les chiffres.
          if (/^(is|est)(Demo|Test|Fake|Seed|Sample)$/i.test(c[1])) { marqueursTest.push(c[1]); continue; }
          if (/^(est|is|has|a)[A-Z]/.test(c[1])) discriminants.push(c[1]);
        }
        // Une énumération n'est un discriminant de SORTE que si elle dit ce qu'EST la ligne
        // (type, kind, genre, sorte), pas où elle en est (statut : un mandat expiré reste un
        // mandat, et une liste de mandats les montre tous). Et elle ne compte que si les
        // lecteurs de la table s'en servent vraiment : au moins deux, et la moitié d'entre
        // eux. Sans ce vote, la réparation de l'analyse des unions multi-lignes a fait
        // sortir 45 lignes d'un coup sur un dépôt réel, presque toutes fausses.
        const enumsCandidats = [];
        for (const [champ, vals] of unionsDuBloc(bloc)) {
          if (vals.length >= 2 && vals.length <= 6 && /^(type|kind|genre|sorte|categorie|category|nature)$/i.test(champ)) enumsCandidats.push(champ);
        }
        for (const champ of enumsCandidats) {
          let total = 0, avec = 0;
          for (const f of code) {
            if (/schema\.ts$|\.test\.ts$|\.spec\.ts$/.test(f.rel)) continue;
            for (const m of f.txt.matchAll(new RegExp(`\\.query\\(\\s*["'\`]${table}["'\`]\\s*\\)`, 'g'))) {
              total++;
              if (chaineDeRequete(f.txt, m.index).includes(champ)) avec++;
            }
          }
          if (avec >= 2 && avec / Math.max(1, total) >= 0.5) discriminants.push(champ);
        }
        // Lecteurs qui ne filtrent pas le marqueur de démo : chiffres pollués.
        for (const f of code) {
          if (/schema\.ts$|\.test\.ts$|\.spec\.ts$/.test(f.rel) || !marqueursTest.length) continue;
          for (const m of f.txt.matchAll(new RegExp(`\\.query\\(\\s*["'\`]${table}["'\`]\\s*\\)`, 'g'))) {
            const suite = chaineDeRequete(f.txt, m.index);
            if (marqueursTest.some((d) => suite.includes(d))) continue;
            if (estMaintenance(f.txt, m.index)) continue;
            pollues.push(`${f.rel}:${lineAt(f.txt, m.index)}  lit « ${table} » sans exclure ${marqueursTest.join('/')}`);
          }
        }

        /* Le FILTRE DE LOCATAIRE est un discriminant aussi, et le plus coûteux quand il
           manque : la vignette d'un autre client dans le lecteur. On ne connaît pas le nom
           du champ à l'avance (clerkUserId chez l'un, workspaceId chez l'autre) : on le
           déduit par VOTE DE MAJORITÉ parmi les lectures de la même table. Si la plupart
           filtrent sur un champ de locataire et qu'une lecture ne filtre sur rien, c'est
           elle qui a oublié. Mesuré à l'aveugle : 0/4 puis 0/4 de ces oublis étaient vus.
           LISTE NÉGATIVE : jamais sans majorité (au moins 2 lectures filtrées et 60 %) ;
           jamais sur une fonction interne, un cron, un chemin de maintenance (ils lisent tous
           les locataires, c'est leur travail) ; jamais sur une lecture déjà bornée par un
           identifiant parent (`.eq("contentItemId", …)` : l'enfant hérite du cloisonnement) ;
           jamais si le filtre est appliqué juste après en JavaScript (`.filter(x => x.orgId`). */
        {
          // Un champ de locataire : un identifiant de compte, d'organisation, d'espace, ou
          // n'importe quel champ qui se termine par ClerkUserId / ClerkId (acceptedByClerkUserId,
          // coachClerkId…). La liste ne prétend pas être fermée, c'est la forme qui compte.
          const TENANT = /\b(\w*(?:ClerkUserId|ClerkId|clerkUserId|clerkId)|orgId|organizationId|organisationId|workspaceId|tenantId|accountId|companyId|teamId|ownerId|ownerUserId|userId|proprietaireId|courtierId|agenceId|coachId|memberId)\b/;
          // La table des comptes (users…) n'est PAS exclue : `query("users").first()` sans
          // filtre patche le profil d'un inconnu (cas planté, vu puis perdu quand on l'excluait).
          // Ce sont les recherches par clé, les crons internes et les vues d'administration
          // qui la lisaient légitimement, et chacun a sa propre exception ci-dessous.
          {
          const lectures = [];
          for (const f of code) {
            // Un fichier de maintenance (nettoyage, intégrité, migration, admin) lit toutes
            // les lignes de tous les locataires : c'est son travail, pas un oubli.
            if (/schema\.ts$|\.test\.ts$|\.spec\.ts$|_generated|(^|\/)[\w.-]*(seed|migration|script|cron|clean|purge|maint|integrity|integrite|backfill|admin|debug|health|monitor|sante|recoll|repar|repair|fix)[\w.-]*\.[tj]s$/i.test(f.rel)) continue;
            for (const m of f.txt.matchAll(new RegExp(`\\.query\\(\\s*["'\`]${table}["'\`]\\s*\\)`, 'g'))) {
              const suite = chaineDeRequete(f.txt, m.index);
              const apres = f.txt.slice(m.index + suite.length, m.index + suite.length + 300);
              const champTenant = (suite.match(new RegExp(`\\.eq\\(\\s*(?:q\\.field\\()?["'\`](${TENANT.source.slice(3, -3)})["'\`]`)) || [])[1]
                || (new RegExp(`\\.(?:filter|find|some|every)\\(\\s*\\(?\\w+\\)?\\s*=>[^;]{0,120}?\\.(${TENANT.source.slice(3, -3)})\\b`).test(suite + apres) ? 'js' : null);
              // Une lecture qui filtre déjà sur une clé (un identifiant parent, un email, un
              // code, un jeton) est une RECHERCHE, pas un balayage : l'oubli de locataire
              // qu'on traque est la lecture qui ramène toute la table. Seuls les filtres sur
              // une catégorie (status, type…) restent des balayages multi-locataires.
              const eqs = [...suite.matchAll(/\.eq\(\s*(?:q\.field\()?["'`](\w+)["'`]/g)].map((x) => x[1]);
              // Un `.find(…)` juste après la lecture cherche UNE ligne par une clé : recherche, pas balayage.
              const parParent = /by_id|"_id"/.test(suite) || /\.find\(/.test(suite + apres.slice(0, 80)) || eqs.some((c) => !/^(status|statut|state|etat|type|kind|genre|categorie|category|actif|active|archived|archive|isDemo|isTest)$/i.test(c));
              // Une fonction gardée par un secret partagé (process.env.X_SECRET) est un canal
              // serveur à serveur : elle lit tous les locataires pour un service, pas pour un écran.
              const debutFn = Math.max(f.txt.lastIndexOf('\nexport const', m.index), 0);
              const avantDansFn = f.txt.slice(debutFn, m.index);
              // … et une porte réservée à un rôle (admin, fondateur, staff) lit tous les
              // locataires par définition : une vue d'administration n'est pas une fuite.
              const secret = /process\.env\.\w*(SECRET|TOKEN|KEY)\w*/.test(avantDansFn)
                || /\b\w*(?:admin|founder|fondateur|staff|super)\w*\s*\(/i.test(avantDansFn);
              lectures.push({ f, index: m.index, champTenant, parParent, secret });
            }
          }
          const avec = lectures.filter((l) => l.champTenant && l.champTenant !== 'js');
          const sans = lectures.filter((l) => !l.champTenant && !l.parParent && !l.secret);
          // Le vote se fait entre BALAYAGES (lectures qui ramènent un ensemble) : les
          // recherches par clé sont neutres, elles ne disent rien de la convention.
          const balayages = avec.length + sans.length;
          // Majorité nette : au moins trois balayages filtrés, ou trois quarts d'entre eux.
          // Deux sur trois, c'est une convention en train de naître, pas une règle du dépôt.
          if ((avec.length >= 3 || avec.length / balayages >= 0.75) && avec.length >= 2 && avec.length / balayages >= 0.6 && sans.length) {
            const compte = {};
            for (const l of avec) compte[l.champTenant] = (compte[l.champTenant] || 0) + 1;
            const cle = Object.entries(compte).sort((a, b) => b[1] - a[1])[0][0];
            // Sur la table des comptes (users…), lister ou compter tout le monde est fréquent
            // et légitime (premier utilisateur, roster d'administration, tâche sur tous les
            // comptes : 3 faux sur 3). Ce qui ne l'est jamais : y prendre UNE ligne au hasard
            // (.first() sans filtre) pour la modifier ou la rendre. On ne garde que ce cas-là.
            const tableDesComptes = /^(users?|profiles?|accounts?|comptes?|membres?|members?|utilisateurs?)$/i.test(table);
            for (const l of sans) {
              if (tableDesComptes && !/\.(first|unique)\(\)/.test(chaineDeRequete(l.f.txt, l.index))) continue;
              if (estMaintenance(l.f.txt, l.index)) continue;
              // La fonction ENGLOBANTE : la dernière déclaration avant la lecture, pas la
              // première du fichier (une expression gloutonne rendait le nom de la première
              // fonction du fichier, et un cron interne passait pour une query publique).
              const avantLecture = l.f.txt.slice(0, l.index);
              const iDecl = avantLecture.lastIndexOf('export const ');
              const decl = iDecl === -1 ? null : avantLecture.slice(iDecl).match(/export const \w+\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)[^]*$/);
              // Une fonction interne lit légitimement tous les locataires (cron, agrégation),
              // SAUF si elle reçoit un locataire en argument : alors elle devait filtrer dessus.
              if (decl && /^internal/.test(decl[1]) && !new RegExp(`\\bargs\\s*:\\s*\\{[^}]*${TENANT.source}`).test(decl[0])) continue;
              // Pas de décompte dans le message : il changerait à chaque lecture ajoutée
              // ailleurs, et chaque ligne passerait pour un signalement neuf.
              manques.push(`${l.f.rel}:${lineAt(l.f.txt, l.index)}  lit « ${table} » sans son filtre de locataire (${cle}), que la plupart des autres lectures de cette table appliquent`);
            }
          }
        }
        }

        if (!discriminants.length) continue;

        // Lecteurs de la table qui ne mentionnent aucun discriminant dans leur voisinage.
        for (const f of code) {
          if (/schema\.ts$|\.test\.ts$|\.spec\.ts$/.test(f.rel)) continue;
          for (const m of f.txt.matchAll(new RegExp(`\\.query\\(\\s*["'\`]${table}["'\`]\\s*\\)`, 'g'))) {
            const suite = chaineDeRequete(f.txt, m.index);
            if (discriminants.some((d) => suite.includes(d))) continue;
            // Les chemins de maintenance lisent tout, c'est normal.
            if (estMaintenance(f.txt, m.index)) continue;
            manques.push(`${f.rel}:${lineAt(f.txt, m.index)}  lit « ${table} » sans filtrer sur ${discriminants.join('/')}`);
          }
        }
      }
    }
    out.push(['E2', 'E', 'BLOQUANT', `Tables partagées lues sans leur discriminant (${manques.length})`, manques,
      "Une table qui porte deux sortes de lignes et un écran qui les traite toutes pareil : le client voit un membre affiché comme une distillerie. Le défaut se propage à tous les lecteurs, et un filtre sans rapport ailleurs peut le masquer longtemps.\nMéthode : lister TOUS les lecteurs de la table, séparer ceux qui exposent une étiquette à l'écran de ceux qui maintiennent la donnée. Seuls les premiers sont des bugs.\nIncident fondateur : crm_leads, client D, 05/09/2026."]);

    out.push(['E6', 'E', 'BLOQUANT', `Données de démonstration comptées comme réelles (${pollues.length})`, pollues,
      "Le schéma distingue les lignes de démonstration par un marqueur, et ces lectures ne l'excluent pas. Conséquence : les compteurs, les moyennes et les tableaux de bord du client additionnent du faux avec du vrai. Le chiffre a l'air normal, il est faux, et il le restera.\nRègle : tout agrégat exclut explicitement le marqueur ; seuls les chemins de maintenance lisent tout."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     E3 · Registres parallèles désynchronisés.
     Incident Data OS Bold Shift : ajouter un module demandait QUATRE endroits
     (Sidebar.tsx, nav/modules.ts, ShellGate SHELL_PREFIXES, convex/users.ts ALL_MODULES).
     Un seul oublié et le module n'apparaît pas, ou s'affiche sans coquille, ou reste
     invisible aux comptes restreints.
  ─────────────────────────────────────────────────────────────────────── */
  {
    // Un registre : une constante en MAJUSCULES contenant une liste de chemins de routes.
    const registres = [];
    for (const f of code) {
      for (const m of f.txt.matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]{3,})\s*(?::[^=]{0,80})?=\s*\[([\s\S]{0,1200}?)\]/g)) {
        const routes = [...m[2].matchAll(/["'`](\/[a-z0-9][\w/-]*)["'`]/g)].map((x) => x[1]);
        if (routes.length < 3) continue;
        registres.push({ nom: m[1], fichier: f.rel, ligne: lineAt(f.txt, m.index), routes: [...new Set(routes)] });
      }
    }
    const ecarts = [];
    for (let i = 0; i < registres.length; i++) {
      for (let j = i + 1; j < registres.length; j++) {
        const a = registres[i], b = registres[j];
        if (a.fichier === b.fichier && a.nom === b.nom) continue;
        const A = new Set(a.routes), B = new Set(b.routes);
        const commun = [...A].filter((x) => B.has(x));
        // Deux registres qui se recouvrent largement décrivent la même chose.
        const recouvrement = commun.length / Math.min(A.size, B.size);
        if (commun.length < 3 || recouvrement < 0.6) continue;
        const manqueDansB = [...A].filter((x) => !B.has(x));
        const manqueDansA = [...B].filter((x) => !A.has(x));
        if (!manqueDansA.length && !manqueDansB.length) continue;
        ecarts.push(`${a.nom} (${a.fichier}:${a.ligne}) et ${b.nom} (${b.fichier}:${b.ligne}) : ${
          manqueDansB.length ? `absent du second : ${manqueDansB.slice(0, 4).join(', ')}` : ''}${
          manqueDansB.length && manqueDansA.length ? ' · ' : ''}${
          manqueDansA.length ? `absent du premier : ${manqueDansA.slice(0, 4).join(', ')}` : ''}`);
      }
    }
    out.push(['E3', 'E', 'À TRAITER', `Registres parallèles désynchronisés (${ecarts.length})`, ecarts,
      "La même liste de routes déclarée à deux endroits, et les deux ne disent pas la même chose. Selon l'endroit oublié : le module n'apparaît pas dans le menu, s'affiche sans sa coquille, ou reste invisible aux comptes restreints.\nUn registre doit avoir un seul propriétaire ; les autres le dérivent.\nIncident fondateur : sidebar hardcodée, Data OS Bold Shift."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     E4 · Valeur écrite hors du vocabulaire fermé.
     Règle d'or Thomas, 17/06/2026 : un agent invente des valeurs « plausibles »
     (source: "web-search" au lieu de "outbound"), ça pourrit la donnée et casse
     silencieusement les vues et les filtres qui comparent à l'enum.

     Un enum appartient à UNE table : deux tables peuvent avoir un champ « role » avec
     des vocabulaires différents. On ne compare donc que les écritures dont la table est
     explicite (insert / replace), sinon on fabrique des faux positifs en masse.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const hors = [];
    if (exists && exists('convex/schema.ts')) {
      const schema = read('convex/schema.ts');
      const parTable = new Map(); // table → Map(champ → valeurs)
      for (const t of schema.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable\(\{([\s\S]*?)^\s{2}\}\)/gm)) {
        const champs = unionsDuBloc(t[2]);
        if (champs.size) parTable.set(t[1], champs);
      }

      for (const f of code) {
        if (/schema\.ts$/.test(f.rel)) continue;
        // Écriture dont la table est nommée : .insert("table", { … }) / .replace(id, { … })
        for (const m of f.txt.matchAll(/\.(insert|replace)\(\s*["'`](\w+)["'`]\s*,\s*\{/g)) {
          const champs = parTable.get(m[2]);
          if (!champs) continue;
          // L'objet écrit, borné par ses accolades : une fenêtre de 900 caractères mordait
          // sur l'écriture suivante et attribuait à « offres » un statut écrit dans « biens »
          // (deux faux positifs arbitrés sur le banc figé, exactement cette erreur).
          const ouvre = m.index + m[0].length - 1;
          let prof = 0, k = ouvre;
          for (; k < Math.min(f.txt.length, ouvre + 4000); k++) {
            if (f.txt[k] === '{') prof++;
            else if (f.txt[k] === '}') { prof--; if (prof === 0) break; }
          }
          const objet = f.txt.slice(m.index, k + 1);
          for (const [champ, vals] of champs) {
            // Le littéral se capture jusqu'au MÊME guillemet que celui qui l'ouvre : « Aujourd'hui »
            // ne s'arrête pas à l'apostrophe.
            for (const c of objet.matchAll(new RegExp(`\\b${champ}\\s*:\\s*(["'\`])((?:(?!\\1)[^\\n]){1,40})\\1`, 'g'))) {
              if (vals.includes(c[2])) continue;
              hors.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${m[2]}.${champ} = "${c[2]}" hors vocabulaire (attendu : ${vals.slice(0, 6).join(' | ')})`);
            }
          }
        }
      }

      /* L'autre moitié du même défaut : la COMPARAISON hors vocabulaire. Un filtre
         `q.eq("statut", "gagnee")` quand le schéma dit « gagne » ne lève rien : l'onglet
         reste vide à vie, et le compteur dit 0 avec aplomb. Mesuré à l'aveugle : 0/4 puis
         0/4 de ces comparaisons étaient vues.
         LISTE NÉGATIVE : jamais quand la table n'a pas d'énumération pour ce champ (un
         v.string() n'a pas de vocabulaire, rien à comparer) ; jamais dans les fichiers de
         test ; jamais sur un littéral qui n'a pas la forme d'une valeur d'énumération
         (espace, ponctuation, gabarit) ; pour une comparaison SANS table (x.statut === …),
         jamais si le littéral est admis par au moins une table qui porte ce champ, et jamais
         s'il n'a pas la casse du vocabulaire (« ACTIVE » comparé à un enum en minuscules
         est une réponse d'API tierce, pas une ligne de chez nous). */
      {
        const parChamp = new Map(); // champ → Set(valeurs de toutes les tables)
        for (const [, champs] of parTable) for (const [champ, vals] of champs) {
          if (!parChamp.has(champ)) parChamp.set(champ, new Set());
          for (const v of vals) parChamp.get(champ).add(v);
        }
        // Un champ homonyme déclaré ailleurs SANS énumération lisible (v.string(), ou un
        // validateur nommé comme `canal: vCanal`) rend le vocabulaire incomplet : on ne
        // peut plus dire qu'un littéral lui est étranger. Vécu : « genre » énuméré dans
        // une table et v.string() dans une autre, 3 faux positifs sur 3.
        for (const t of schema.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable\(\{([\s\S]*?)^\s{2}\}\)/gm)) {
          for (const m of t[2].matchAll(/^\s{4}(\w+)\s*:\s*(?:v\.optional\()?(?!v\.union\()([\w.]+)/gm)) {
            if (parChamp.has(m[1])) parChamp.delete(m[1]);
          }
        }
        const ENUM_LIKE = /^[A-Za-z0-9_\-]{2,40}$/;
        const memeCasse = (lit, vals) => {
          const minus = [...vals].every((v) => v === v.toLowerCase());
          const majus = [...vals].every((v) => v === v.toUpperCase());
          if (minus) return lit === lit.toLowerCase();
          if (majus) return lit === lit.toUpperCase();
          return true;
        };
        for (const f of code) {
          if (/schema\.ts$|\.test\.|\.spec\.|_generated/.test(f.rel)) continue;
          // a) Dans une chaîne de requête, la table est connue : verdict exact.
          for (const m of f.txt.matchAll(/\.query\(\s*["'`](\w+)["'`]\s*\)/g)) {
            const champs = parTable.get(m[1]);
            if (!champs) continue;
            const suite = chaineDeRequete(f.txt, m.index);
            for (const c of suite.matchAll(/\.(?:eq|neq)\(\s*(?:q\.field\()?["'`](\w+)["'`]\)?\s*,\s*["'`]([^"'`\n]{1,40})["'`]/g)) {
              const vals = champs.get(c[1]);
              if (!vals || vals.includes(c[2]) || !ENUM_LIKE.test(c[2])) continue;
              hors.push(`${f.rel}:${lineAt(f.txt, m.index + c.index)}  filtre ${m[1]}.${c[1]} = "${c[2]}" hors vocabulaire (attendu : ${vals.slice(0, 6).join(' | ')}) : ce filtre ne trouvera jamais rien`);
            }
          }
          // b) Comparaison sur un champ, table inconnue : le littéral doit être étranger à
          //    TOUTES les tables qui portent ce champ. Backend seulement : dans un écran,
          //    l'objet comparé vient trop souvent d'ailleurs (un membre d'équipe en dur dont
          //    le « role » n'a rien à voir avec celui des contacts : vécu, 2 faux sur 2).
          if (!/^convex\//.test(f.rel)) continue;
          for (const c of f.txt.matchAll(/\.(\w+)\s*(?:===|!==|==|!=)\s*["'`]([^"'`\n]{1,40})["'`]|["'`]([^"'`\n]{1,40})["'`]\s*(?:===|!==|==|!=)\s*[\w.]+\.(\w+)\b/g)) {
            const champ = c[1] || c[4], lit = c[2] || c[3];
            const vals = parChamp.get(champ);
            if (!vals || vals.has(lit) || !ENUM_LIKE.test(lit) || !memeCasse(lit, vals)) continue;
            // Sans table connue, on n'accuse que la QUASI-VALEUR : à deux lettres près d'un
            // membre du vocabulaire (« gagnee » pour « gagne », « en-cours » pour « en_cours »).
            // Un littéral lointain (« actif » face à ok | echec) est presque toujours le champ
            // homonyme d'un autre objet : 32 comparaisons signalées sur un dépôt réel, aucune
            // vraie, avant cette borne.
            // Une lettre d'écart, deux seulement pour un mot d'au moins huit lettres : à deux
            // lettres près, « thumb » ressemble à « theme » sans en être une faute de frappe.
            const proche = [...vals].find((v) => Math.abs(v.length - lit.length) <= 2 && levenshtein(v.toLowerCase(), lit.toLowerCase()) <= (Math.max(v.length, lit.length) >= 8 ? 2 : 1));
            if (!proche) continue;
            hors.push(`${f.rel}:${lineAt(f.txt, c.index)}  compare « ${champ} » à "${lit}", absent du vocabulaire du schéma (proche de « ${proche} ») : cette branche ne s'exécute jamais`);
          }
        }
      }
    }
    out.push(['E4', 'E', 'BLOQUANT', `Valeurs écrites ou comparées hors du vocabulaire déclaré (${hors.length})`, hors,
      "Le schéma déclare un vocabulaire fermé et le code écrit ou compare autre chose. Ça ne lève aucune erreur visible : la ligne part en base et toutes les vues qui comparent à l'enum l'ignorent ; ou bien le filtre ne trouve jamais rien et l'onglet reste vide à vie. C'est une donnée perdue qui a l'air présente, ou un zéro qui a l'air vrai.\nRègle d'or : la liberté d'action n'est pas la liberté de vocabulaire."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     E5 · Argent additionné sans conversion, taux de change écrit en dur.
     Audit projet client B 26/06/2026 : tout supposait des CHF, un taux USD→CHF de 0.7961 était
     écrit en dur et faux. Cause racine de plusieurs chiffres faux à l'écran.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const suspects = [];
    const CONVERSION = /(toEur|toChf|toUsd|convert|fxTo|fx\[|fxMap|rate|taux)/i;
    // Un nom se lit par MOTS ENTIERS (casse chameau, tiret bas, tiret), jamais par
    // sous-chaîne : « largeurColonne » contient « eur » et n'a rien d'une devise. Vécu :
    // deux faux « taux de change écrit en dur » sur un fichier qui ne parlait que de pixels.
    const MOTS_DEVISE = new Set(['rate', 'taux', 'fx', 'usd', 'eur', 'chf', 'gbp']);
    const motsDe = (nom) => nom
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+|\s+/).filter(Boolean).map((w) => w.toLowerCase());
    for (const f of code) {
      // Taux de change écrit en dur
      for (const m of f.txt.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(0?\.\d{3,}|\d\.\d{3,})\b/g)) {
        if (!motsDe(m[1]).some((w) => MOTS_DEVISE.has(w))) continue;
        suspects.push(`${f.rel}:${lineAt(f.txt, m.index)}  taux de change écrit en dur (${m[2]})`);
      }
      // Somme de montants sans conversion visible
      for (const m of f.txt.matchAll(/\.reduce\(\s*\([^)]{0,40}\)\s*=>\s*[\s\S]{0,120}?\b(\w*(?:amount|montant|price|prix|total|value|valeur|ca|revenue)\w*)\b/gi)) {
        const extrait = f.txt.slice(m.index, m.index + 200);
        if (CONVERSION.test(extrait)) continue;
        if (!/currency|devise/i.test(f.txt)) continue; // le fichier manipule des devises
        suspects.push(`${f.rel}:${lineAt(f.txt, m.index)}  somme de « ${m[1]} » sans conversion alors que le fichier manipule des devises`);
      }
    }
    out.push(['E5', 'E', 'À TRAITER', `Argent additionné sans conversion (${suspects.length})`, suspects,
      "Additionner des montants de devises différentes donne un nombre qui ne veut rien dire, et personne ne s'en aperçoit parce que le résultat a l'air plausible. Un taux écrit en dur est faux le lendemain.\nRègle : montant stocké dans sa devise d'origine, converti dans TOUTE requête d'agrégat par un convertisseur unique, affiché seulement à la fin.\nAudit fondateur : projet client B, 26/06/2026."]);
  }

  return out.map(([id, axe, grav, titre, items, detail]) => {
    const uniques = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${uniques.length})`), uniques, detail];
  });
}

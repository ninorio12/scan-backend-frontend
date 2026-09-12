// extraire.mjs — énumère les PORTEURS DE SENS d'un dépôt.
// On ne cherche aucun défaut ici. On construit le dénominateur : la liste des choses
// qui, dans ce produit, prétendent signifier quelque chose.
//
// Usage : node extraire.mjs <racine> [--out f.json]
//
// CE FICHIER NE SUPPOSE PLUS DE BASE DE DONNÉES. Ce qu'est « une table », « une
// lecture », « une écriture » est la réponse d'un adaptateur (`adapters/extraction-*`) :
// Convex, ou Prisma / Drizzle / Supabase / SQL brut. Avant ce partage, l'extracteur
// avait `defineSchema` et `ctx.db.insert` écrits dans son corps, et rendait 0 table et
// 0 écriture sur tout projet non-Convex — un zéro que les juges en aval présentaient
// comme « rien à signaler ».

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { cleNorm, chaineNorm, unite, normJetons } from "./lexique.mjs";
import convexEx, { KIND_SERVEUR } from "./adapters/extraction-convex.mjs";
import sqlEx from "./adapters/extraction-sql.mjs";
import trpcEx from "./adapters/extraction-trpc.mjs";

/* L'ordre compte : Convex répond le premier, parce que c'est la base dont l'extracteur
   sait tout dire. Un adaptateur qui a reconnu une écriture arrête la chaîne. */
const ADAPTATEURS = [convexEx, sqlEx, trpcEx];

const require_ = createRequire(import.meta.url);

/* TypeScript se prend DANS LE PROJET AUDITÉ, pas sur la machine : c'est ainsi qu'on
   analyse chaque dépôt avec la version qu'il utilise réellement. On remonte depuis le
   dépôt jusqu'à la racine, puis on prend celui du skill (installé par `npm install`
   dans le dossier du skill), puis le global. (Avant, cette liste contenait les chemins
   en dur de trois projets d'une machine : le skill ne pouvait pas servir ailleurs.) */
function chargerTs(depuis) {
  const essais = [];
  let d = path.resolve(depuis || process.argv[2] || ".");
  for (let i = 0; i < 8; i++) {
    essais.push(path.join(d, "node_modules", "typescript"));
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  essais.push("typescript");   // celui du skill (node_modules du skill), sinon le global
  for (const c of essais) { try { return require_(c); } catch { /* suivant */ } }
  throw new Error(
    "typescript introuvable. Ce skill lit le code avec le compilateur du projet audité :\n" +
    "  lancer `npm install` dans le dépôt audité, ou `npm install` dans le dossier du skill.");
}
/* Chargement PARESSEUX : au premier appel d'extraire(), quand on connaît enfin le
   dépôt. Le faire à l'import échouait dès qu'on utilisait ce fichier comme module,
   puisque le chemin du dépôt n'est connu qu'à l'appel. */
let ts = null;
const TS = (racine) => (ts ||= chargerTs(racine));

const IGNORE = /node_modules|[\\/]\.next[\\/]|[\\/]_generated[\\/]|[\\/]\.git[\\/]|[\\/]dist[\\/]|[\\/]build[\\/]|\.d\.ts$/;

function fichiers(racine) {
  const out = [];
  (function marche(d) {
    let e2; try { e2 = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of e2) {
      const p = path.join(d, e.name);
      if (IGNORE.test(p + "/")) continue;
      if (e.isDirectory()) marche(p);
      // .prisma et .sql ne sont pas du TypeScript, mais ce sont des SCHÉMAS : sans eux,
      // un projet Prisma ou Supabase n'a aucune table aux yeux de l'extracteur.
      else if (/\.(ts|tsx|js|jsx|mjs|prisma|sql)$/.test(e.name)) out.push(p);
    }
  })(racine);
  return out;
}

const GARDES = /^(orgCourante|requireAdmin|requireUser|requireOrg|currentUser|getAuth|auth|requireAuth|assertOwner|getUserIdentity|verifierAcces|accesOrg|hasUser)$/;

/** Déplie les propriétés d'un objet littéral, spreads d'objets locaux compris.
 *  Un spread irrésolu renvoie { cle: null, opaque } : on ne prétendra pas savoir. */
function etaler(ts_, sf, obj, objetsLocaux, T) {
  const out = [];
  for (const p of obj.properties) {
    if (ts_.isPropertyAssignment(p)) out.push({ cle: p.name.getText(sf).replace(/["']/g, ""), formule: T(p.initializer).slice(0, 140), noeud: p });
    else if (ts_.isShorthandPropertyAssignment(p)) out.push({ cle: p.name.text, formule: p.name.text, noeud: p });
    else if (ts_.isSpreadAssignment(p)) {
      const src = T(p.expression);
      const cles = objetsLocaux.get(src);
      if (cles) for (const c of cles) out.push({ cle: c, formule: `${src}.${c}`, noeud: p });
      else out.push({ cle: null, opaque: src, noeud: p });
    }
  }
  return out;
}

export function extraire(racine) {
  TS(racine);
  const elements = [];
  const aretes = [];
  let n = 0;

  const ajouter = (e) => {
    e.id = e.id || `${e.classe}#${e.fichier}:${e.ligne}:${e.nom}#${n++}`;
    e.cle = cleNorm(e.nom);
    e.chaine = chaineNorm(e.nom);
    e.jetons = normJetons(e.nom);
    e.unite = e.unite ?? unite(e.nom, e.typeTexte || "");
    elements.push(e);
    return e;
  };
  const lier = (de, vers, type, info) => aretes.push({ de, vers, type, ...(info || {}) });

  /* L'état que les adaptateurs partagent d'un fichier à l'autre : les tables déclarées
     et, pour Drizzle, le nom de la constante qui les désigne. Il DOIT être rempli avant
     le parcours principal : le schéma vit dans `drizzle/schema.ts` et les requêtes dans
     `src/app/api/**`. Un extracteur qui lit les fichiers dans l'ordre alphabétique voit
     la requête avant la table, et ne sait pas de quoi elle parle. */
  const etat = { tables: new Map(), alias: new Map() };
  for (const a of ADAPTATEURS) {
    if (!a.prePasse) continue;
    a.prePasse({ racine, fichiers: fichiers(racine), fs, path, ajouter, lier, etat });
  }

  for (const fp of fichiers(racine)) {
    let texte; try { texte = fs.readFileSync(fp, "utf8"); } catch { continue; }
    const rel = path.relative(racine, fp);
    if (/\.(prisma|sql)$/.test(rel)) continue;   // lus en pré-passe, pas du TypeScript
    let sf;
    try {
      sf = ts.createSourceFile(fp, texte, ts.ScriptTarget.Latest, true,
        fp.endsWith("x") ? ts.ScriptKind.TSX : /\.tsx?$/.test(fp) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    } catch { continue; }

    const L = (nd) => sf.getLineAndCharacterOfPosition(nd.getStart(sf)).line + 1;
    const T = (nd) => { try { return nd.getText(sf); } catch { return ""; } };
    // Les chaînes d'appel sont souvent réparties sur plusieurs lignes :
    // « ctx.db\n  .query("x") ». Sans cette normalisation, la moitié des
    // détecteurs sont aveugles (bug mesuré : tables vides sur 20 fonctions).
    const C = (nd) => T(nd).replace(/\s+/g, "");

    if (/[\\/]route\.(ts|js)$/.test(rel)) {
      const chemin = "/" + path.dirname(rel).replace(/\\/g, "/").replace(/^(src\/)?app\//, "");
      ajouter({ classe: "route.definie", nom: chemin, fichier: rel, ligne: 1, entite: path.basename(path.dirname(rel)), role: "producteur" });
    }
    if (/[\\/]page\.(tsx|jsx)$/.test(rel)) {
      let chemin = "/" + path.dirname(rel).replace(/\\/g, "/").replace(/^(src\/)?app\//, "").replace(/\([^)]*\)\//g, "");
      if (chemin === "/." || chemin === "/app") chemin = "/";
      ajouter({ classe: "ecran", nom: chemin, fichier: rel, ligne: 1, entite: path.basename(path.dirname(rel)), role: "consommateur" });
    }

    const pile = [];
    const argsTables = new Map();
    const porteur = () => pile.length ? pile[pile.length - 1] : null;
    const litterauxDe = (nd) => { const o = []; (function v(x) { if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) o.push(x.text); ts.forEachChild(x, v); })(nd); return o; };

    // ---------------------------------------------------------------- schéma
    /* Le schéma n'est plus une forme connue d'avance : on demande à chaque adaptateur
       si ce nœud déclare des tables dans SA base. Convex répond sur `defineSchema` ; les
       schémas qui vivent hors du TypeScript (`.prisma`, `.sql`) sont lus en pré-passe. */
    function visiterSchema(nd) {
      const api = { ts, sf, T, C, L, rel, ajouter, lier, litterauxDe };
      for (const a of ADAPTATEURS) {
        if (a.schemaAuNoeud && a.schemaAuNoeud(nd, api)) return true;
      }
      return false;
    }

    // ------------------------------------------------ signature de population
    function population(handler) {
      const pop = { tables: [], predicats: [], bornes: [], periodes: [], ordre: null };
      (function v(x) {
        if (ts.isCallExpression(x)) {
          const cible = C(x.expression);
          /* QUELLE TABLE, et QUOI LA BORNE : la réponse appartient à la base. Convex dit
             `ctx.db.query(…).withIndex().take()`, Prisma `prisma.lead.findMany`, Drizzle
             `db.select().from(leads).limit()`, Supabase `.from("leads").limit()`. */
          for (const a of ADAPTATEURS) if (a.lecture) a.lecture(cible, x, { ts, sf, T, C, pop, etat });
          if (/\.order$/.test(cible)) pop.ordre = T(x.arguments[0] || x).replace(/["']/g, "");
          if (/\.filter$/.test(cible) && x.arguments[0]) (function w(y) {
            if (ts.isBinaryExpression(y) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken].includes(y.operatorToken.kind)) {
              const g = T(y.left);
              pop.predicats.push({
                champ: (g.match(/\.([A-Za-z_$][\w$]*)$/) || [, g])[1],
                op: y.operatorToken.getText(sf), valeur: T(y.right).slice(0, 80), provenance: "filtre",
              });
            }
            ts.forEachChild(y, w);
          })(x.arguments[0]);
        }
        if (ts.isBinaryExpression(x)) {
          const s = T(x);
          if (/Date\.now\(\)/.test(s) && /[-+]/.test(s) && s.length < 120) pop.periodes.push(s.replace(/\s+/g, " "));
        }
        if (ts.isIdentifier(x) && /^(debutMois|finMois|moisCourant|debutSemaine|debutJour|debutDuJour)$/.test(x.text)) pop.periodes.push(x.text);
        ts.forEachChild(x, v);
      })(handler);
      pop.tables = [...new Set(pop.tables)];
      pop.periodes = [...new Set(pop.periodes)];
      return pop;
    }

    // ------------------------------------------------------ corps d'une fonction
    function analyserCorps(handler, fEl, entiteDef) {
      const locales = new Map();        // variable -> table Convex
      const formulesLocales = new Map();
      const objetsLocaux = new Map();

      (function pre(x) {
        if (ts.isVariableDeclaration(x) && x.initializer && ts.isIdentifier(x.name)) {
          formulesLocales.set(x.name.text, T(x.initializer).replace(/\s+/g, " ").slice(0, 320));
          if (ts.isObjectLiteralExpression(x.initializer)) {
            objetsLocaux.set(x.name.text, x.initializer.properties.map((q) => q.name ? q.name.getText(sf).replace(/["']/g, "") : null).filter(Boolean));
          }
        }
        // `const maj = {}` PUIS `maj.ville = args.ville` : le patch de mise à jour
        // le plus courant construit son objet par affectations successives. Sans
        // les lire, l'écriture reste « opaque » et l'apparieur s'abstient sur une
        // forme dont il a pourtant toutes les clés sous les yeux.
        if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(x.left) && ts.isIdentifier(x.left.expression)) {
          const base = x.left.expression.text;
          if (objetsLocaux.has(base)) objetsLocaux.set(base, [...new Set([...objetsLocaux.get(base), x.left.name.getText(sf)])]);
        }
        ts.forEachChild(x, pre);
      })(handler);
      fEl.formulesLocales = Object.fromEntries(formulesLocales);

      const enCondition = new Set(), lus = new Set();
      // Les ÉTATS LUS avant d'écrire : quelle variable, quel champ. La table de la
      // variable n'est connue qu'à la fin du corps (c'est le parcours principal qui
      // la remplit), alors on garde le couple brut et on résout après.
      const etatsLus = [];
      (function ctxs(x) {
        const c = ts.isIfStatement(x) ? x.expression : ts.isConditionalExpression(x) ? x.condition : null;
        if (c) {
          for (const m of T(c).matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) enCondition.add(m[1]);
          for (const m of T(c).matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g)) etatsLus.push({ variable: m[1], champ: m[2] });
        }
        if (ts.isPropertyAccessExpression(x)) lus.add(x.name.getText(sf));
        if (ts.isIdentifier(x)) lus.add(x.text);
        ts.forEachChild(x, ctxs);
      })(handler);
      fEl.enCondition = [...enCondition];
      fEl.lit = [...lus];
      fEl.etatsLus = etatsLus;

      const appelsLocaux = new Set();
      (function loc(x) { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) appelsLocaux.add(x.expression.text); ts.forEachChild(x, loc); })(handler);
      fEl.appelsLocaux = [...appelsLocaux].filter((x) => !/^(Number|String|Boolean|Math|Date|JSON|Object|Array|Promise|parseInt|parseFloat|require)$/.test(x));

      // Formes de retour, avec leur branche. « garde-absente » distingue la
      // branche « pas de secret configuré » d'un vrai succès : sans ça, toute
      // route qui renvoie ok:true et 4xx ailleurs est accusée à tort.
      const retours = [];
      (function rets(x, branche) {
        if (ts.isTryStatement(x)) {
          rets(x.tryBlock, branche);
          if (x.catchClause) rets(x.catchClause.block, "secours");
          if (x.finallyBlock) rets(x.finallyBlock, branche);
          return;
        }
        if (ts.isIfStatement(x)) {
          const cond = T(x.expression);
          const absente = /^\s*!\s*[\w.[\]]*(secret|token|key|signature|env|config)/i.test(cond) ||
            /(secret|token|key|signature)\w*\s*(===?\s*(undefined|null|"")|==\s*null)/i.test(cond) ||
            /^!\s*process\.env/.test(cond);
          rets(x.thenStatement, absente ? "garde-absente" : branche);
          if (x.elseStatement) rets(x.elseStatement, branche);
          return;
        }
        if (ts.isReturnStatement(x) && x.expression) {
          const e = x.expression;
          let obj = e;
          if (ts.isCallExpression(e) && e.arguments[0]) obj = e.arguments[0];
          const st = T(e).match(/status:\s*(\d{3})/);
          retours.push({
            branche, ligne: L(x),
            cles: ts.isObjectLiteralExpression(obj) ? obj.properties.map((p) => p.name ? p.name.getText(sf).replace(/["']/g, "") : "?") : [],
            texte: T(e).replace(/\s+/g, " ").slice(0, 170), statut: st ? Number(st[1]) : null,
          });
        }
        ts.forEachChild(x, (y) => rets(y, branche));
      })(handler, "nominal");
      fEl.retours = retours;

      // Un catch qui ne relance rien et ne retourne rien AVALE la panne : la
      // fonction continue son chemin et répondra comme si tout s'était passé.
      // On note aussi si la fonction, ailleurs, laisse une erreur remonter :
      // c'est la discipline à laquelle ce catch fera exception.
      fEl.avale = [];
      (function tries(x) {
        if (ts.isTryStatement(x) && x.catchClause) {
          const b = T(x.catchClause.block);
          if (!/\b(throw|return)\b/.test(b) && !/status:\s*[45]\d\d/.test(b))
            fEl.avale.push({ ligne: L(x.catchClause), texte: b.replace(/\s+/g, " ").slice(0, 120) });
        }
        ts.forEachChild(x, tries);
      })(handler);
      fEl.leve = /\bthrow\s+new\b/.test(T(handler));
      /* Les arguments pris EN BLOC : `const { id, ...fields } = args`,
         `Object.entries(args)`, `{ ...args }`. Chaque argument y passe sans
         jamais être nommé : aucune règle n'a le droit de dire qu'il n'est pas lu.
         Mesuré : 30 faux positifs sur projet client B avant cette abstention. */
      // La forme la plus courante est dans la SIGNATURE : `async (ctx, { id, ...fields })`.
      // Elle ne contient pas le mot « args » : cherchée au texte seul, elle échappe.
      const params = (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler) || ts.isFunctionDeclaration(handler)) ? handler.parameters : [];
      fEl.argsEnBloc = params.some((q) => ts.isObjectBindingPattern(q.name) && q.name.elements.some((e) => e.dotDotDotToken)) ||
        /\.\.\.[A-Za-z_$][\w$]*\s*\}\s*=\s*args\b|Object\.(entries|keys|values|assign)\(\s*args\b|\{\s*\.\.\.args\b/.test(T(handler));

      /* Les DIVISIONS, relevées à l'AST et non au texte. Au texte, « https://api/
         v2/files » et le littéral `/g` d'une expression régulière sont des
         divisions : mesuré, 23 fausses alertes sur projet client A et zéro vraie. À l'AST,
         il n'y en a aucune. On note aussi si le dénominateur est protégé, en
         remontant les conditions qui englobent le calcul. */
      (function divs(x) {
        if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.SlashToken &&
            (ts.isIdentifier(x.right) || ts.isPropertyAccessExpression(x.right))) {
          const den = T(x.right);
          /* Une garde de dénominateur, ce n'est pas « il est testé quelque part » :
             c'est une forme qui EXCLUT LE ZÉRO. `criteres.surface > 110` n'en est
             pas une, `prev <= 0 → return` en est une. On lit tout ce qui précède
             la division dans la fonction qui la porte, plus les conditions qui
             l'englobent, et on n'accepte que ces formes-là.
             Mesuré : 23 fausses alertes projet client A au texte brut, puis 2 sur projet client B quand
             la garde était un `if` frère ou une vérité toute simple. */
          /* On remonte TOUS les niveaux de fonction, pas seulement le premier :
             `const tot = … || 1` est posé dans la fonction porteuse, et la division
             vit dans la petite flèche d'un `.map()`. S'arrêter à la flèche, c'était
             ne jamais voir le repli. */
          let fn = x.parent, conds = "", avant = "", prof = 0;
          while (fn && prof++ < 40) {
            if (ts.isIfStatement(fn)) conds += " " + T(fn.expression);
            else if (ts.isConditionalExpression(fn)) conds += " " + T(fn.condition);
            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn))
              avant += " " + T(fn).slice(0, Math.max(0, x.getStart(sf) - fn.getStart(sf)));
            fn = fn.parent;
          }
          const e = den.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const ZERO = new RegExp(
            `${e}\\s*(>\\s*0|>=\\s*1|<=\\s*0|<\\s*1|===\\s*0|!==\\s*0|==\\s*0|!=\\s*0|\\?\\?|\\|\\||&&|\\?[^?])` +
            `|!\\s*${e}\\b|&&\\s*${e}\\s*[?)]|Math\\.max\\(\\s*${e}|\\bisNaN\\b|\\bisFinite\\b` +
            // `const tot = ... || 1` : le repli est posé à la déclaration, loin de
            // la division. Mesuré : 2 faux positifs sur projet client B.
            `|${e}\\s*=[^;\\n]*(\\|\\||\\?\\?)\\s*[1-9]`);
          ajouter({ classe: "division", nom: T(x).replace(/\s+/g, " ").slice(0, 80), fichier: rel, ligne: L(x),
            role: "calcul", porteur: fEl.fq, entite: entiteDef, denominateur: den, fonction: fEl.nom,
            garde: ZERO.test(avant + " " + conds) });
        }
        ts.forEachChild(x, divs);
      })(handler);

      // écriture lancée sans être attendue : .map(async ...) dont on jette la promesse
      (function flot(x) {
        if (ts.isCallExpression(x) && /\.map$/.test(C(x.expression))) {
          const cb = x.arguments[0];
          const asy = cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.modifiers && cb.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
          if (asy) {
            const p = x.parent;
            const attendu = ts.isAwaitExpression(p) || ts.isReturnStatement(p) ||
              (ts.isCallExpression(p) && /Promise\.(all|allSettled)/.test(T(p.expression))) ||
              (p && p.parent && ts.isCallExpression(p.parent) && /Promise\.(all|allSettled)/.test(T(p.parent.expression)));
            if (!attendu && /ctx\.db\.(patch|insert|delete|replace)|await/.test(T(cb))) {
              ajouter({ classe: "ecriture.flottante", nom: `map async dans ${fEl.nom}`, fichier: rel, ligne: L(x), entite: entiteDef, role: "ecriture", porteur: fEl.fq, formule: T(x).replace(/\s+/g, " ").slice(0, 150) });
            }
          }
        }
        ts.forEachChild(x, flot);
      })(handler);

      function projeter(obj, niveau) {
        for (const p of obj.properties) {
          let k = null, formule = null;
          if (ts.isPropertyAssignment(p)) { k = p.name.getText(sf); formule = T(p.initializer); }
          else if (ts.isShorthandPropertyAssignment(p)) { k = p.name.text; formule = k; }
          if (!k) continue;
          k = k.replace(/["']/g, "");
          // une projection en raccourci ({ caMois }) renvoie à un calcul local :
          // sans le déplier, l'accord sur la formule et l'unité est aveugle.
          const t = (formule || "").trim();
          if (/^[A-Za-z_$][\w$]*$/.test(t) && formulesLocales.get(t)) formule = `${t} = ${formulesLocales.get(t)}`;
          const src = (formule || "").match(/\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/);
          const el = ajouter({
            classe: "champ.projection", nom: k, fichier: rel, ligne: L(p), entite: entiteDef,
            role: "producteur", porteur: fEl.fq, formule: (formule || "").replace(/\s+/g, " ").slice(0, 220),
            niveau, source: src ? `${entiteDef}.${src[1]}` : null,
          });
          lier(fEl.id, el.id, "produit");
          if (ts.isPropertyAssignment(p)) (function sous(y) {
            if (ts.isObjectLiteralExpression(y)) return projeter(y, `${niveau}>${k}`);
            if (ts.isConditionalExpression(y)) { sous(y.whenTrue); sous(y.whenFalse); return; }
            if (ts.isParenthesizedExpression(y)) return sous(y.expression);
          })(p.initializer);
        }
      }

      /* Le contexte que les adaptateurs reçoivent pour décrire une écriture : de quoi
         nommer la table, déplier l'objet écrit, et rattacher le tout à la fonction. */
      const apiEcriture = () => ({ ts, sf, T, C, L, rel, ajouter, lier, etaler,
        objetsLocaux, locales, argsTables, entiteDef, fEl, etat });

      (function v(x) {
        if (ts.isVariableDeclaration(x) && x.initializer && ts.isIdentifier(x.name)) {
          for (const a of ADAPTATEURS) if (a.variableLocale) a.variableLocale(x, apiEcriture());
        }

        if (ts.isCallExpression(x)) {
          const cible = C(x.expression);

          /* QUI ÉCRIT QUOI, OÙ : `ctx.db.insert/patch/delete` en Convex,
             `prisma.x.create` en Prisma, `db.insert(t).values()` en Drizzle,
             `.from("t").insert()` en Supabase. Le premier adaptateur qui reconnaît la
             forme arrête la chaîne : une écriture n'appartient qu'à une base. */
          for (const a of ADAPTATEURS) if (a.ecriture && a.ecriture(cible, x, apiEcriture())) break;

          const dernier = cible.split(".").pop();
          if (GARDES.test(dernier)) {
            let p = x.parent;
            while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
            // !!(await getUserIdentity()) : le résultat EST utilisé, à travers deux
            // opérateurs unaires. Seul un appel en instruction sèche le jette.
            const utilise = p && !ts.isExpressionStatement(p) && !ts.isBlock(p);
            const g = ajouter({
              classe: "garde", nom: dernier, fichier: rel, ligne: L(x), entite: entiteDef, role: "garde",
              porteur: fEl.fq, resultatUtilise: !!utilise, liaisons: p && ts.isVariableDeclaration(p) ? T(p.name) : null,
            });
            lier(fEl.id, g.id, "protege");
          }

          if (/ctx\.(runMutation|runQuery|runAction)$/.test(cible) || /scheduler\.run(After|At)$/.test(cible)) {
            const ref = T(x).match(/(?:internal|api)\.([\w.]+)/);
            if (ref) { const a = ajouter({ classe: "appel", nom: ref[1], fichier: rel, ligne: L(x), entite: entiteDef, role: "chaine", porteur: fEl.fq, fqCible: ref[1] }); lier(fEl.id, a.id, "appelle"); }
          }

          if (cible === "fetch") {
            const u = x.arguments[0] ? T(x.arguments[0]).replace(/["'`]/g, "") : "";
            const a = ajouter({ classe: "route.appelee", nom: u.slice(0, 130), fichier: rel, ligne: L(x), entite: entiteDef, role: "chaine", porteur: fEl.fq, externe: /^https?:/.test(u) });
            lier(fEl.id, a.id, "appelle");
          }

          if (/\.(set|push|unshift|add)$/.test(cible)) {
            // un producteur ne construit pas toujours sa forme dans un return :
            // beaucoup passent par map.set(cle, {...}) ou tableau.push({...}).
            for (const arg of x.arguments) if (ts.isObjectLiteralExpression(arg) && arg.properties.length >= 2) projeter(arg, "collecte");
          }
          if (/\.map$/.test(cible) && x.arguments[0]) {
            const cb = x.arguments[0];
            if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
              const b = cb.body;
              if (ts.isParenthesizedExpression(b) && ts.isObjectLiteralExpression(b.expression)) projeter(b.expression, "ligne");
              else if (ts.isObjectLiteralExpression(b)) projeter(b, "ligne");
            }
          }
        }

        // Une comparaison de texte a DEUX côtés, et chacun peut être mis à la même
        // graduation ou non (casse, accents, espaces). C'est le substrat de l'accord
        // sur l'unité appliqué aux chaînes : « includes(terme) » ne veut pas dire la
        // même chose selon que le champ a été abaissé en minuscules ou non.
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) &&
            /^(includes|startsWith|endsWith|indexOf|search)$/.test(x.expression.name.getText(sf)) && x.arguments[0]) {
          const NORM = /\.(toLowerCase|toUpperCase|normalize|trim|toLocaleLowerCase|toLocaleUpperCase)\s*\(/;
          const gauche = T(x.expression.expression), droite = T(x.arguments[0]);
          const nu = gauche.replace(/\.(toLowerCase|toUpperCase|normalize|trim|toLocaleLowerCase|toLocaleUpperCase)\s*\([^)]*\)/g, "");
          const champ = (nu.match(/\.([A-Za-z_$][\w$]*)$/) || [, nu])[1];
          if (champ && /^[A-Za-z_$][\w$]*$/.test(champ) && droite.length < 60)
            ajouter({ classe: "comparaison.texte", nom: champ, fichier: rel, ligne: L(x), entite: entiteDef,
              role: "recherche", porteur: fEl.fq, terme: droite, gauche: gauche.slice(0, 90),
              normalise: NORM.test(gauche), termeNormalise: NORM.test(droite) });
        }

        if (ts.isBinaryExpression(x) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(x.operatorToken.kind)) {
          const cotes = [x.left, x.right];
          const lit = cotes.find((c) => ts.isStringLiteral(c));
          const acc = cotes.find((c) => ts.isPropertyAccessExpression(c));
          if (lit && acc) ajouter({ classe: "litteral.vocabulaire", nom: lit.text, fichier: rel, ligne: L(x), entite: entiteDef, role: "vocabulaire", porteur: fEl.fq, champCible: acc.name.getText(sf), usage: "comparaison" });
        }

        if (ts.isReturnStatement(x) && x.expression) (function col(e) {
          if (ts.isObjectLiteralExpression(e)) projeter(e, "racine");
          else if (ts.isConditionalExpression(e)) { col(e.whenTrue); col(e.whenFalse); }
        })(x.expression);

        ts.forEachChild(x, v);
      })(handler);

      for (const e of fEl.etatsLus || []) e.table = locales.get(e.variable) || argsTables.get(`*.${e.variable}`) || null;
    }

    // ------------------------------------------------- fonctions serveur Convex
    function visiterFonctionServeur(nd) {
      if (!ts.isVariableDeclaration(nd) || !nd.initializer || !ts.isCallExpression(nd.initializer)) return false;
      const kind = T(nd.initializer.expression);
      if (!KIND_SERVEUR.has(kind)) return false;
      const nomFn = T(nd.name);
      const mod = rel.replace(/\.tsx?$/, "").replace(/^(src\/)?convex\//, "").replace(/\\/g, "/");
      const fq = `${mod}.${nomFn}`;
      const conf = nd.initializer.arguments[0];
      let argsObj = null, handler = null;
      if (conf && ts.isObjectLiteralExpression(conf)) {
        for (const p of conf.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          if (p.name.getText(sf) === "args") argsObj = p.initializer;
          if (p.name.getText(sf) === "handler") handler = p.initializer;
        }
      } else if (conf) handler = conf;

      const pop = handler ? population(handler) : null;
      const entite = pop && pop.tables.length ? pop.tables[0] : mod.split("/").pop();
      const fEl = ajouter({ classe: "fonction.serveur", nom: nomFn, fichier: rel, ligne: L(nd), entite, role: /query/i.test(kind) ? "producteur" : "action", kind, fq, pop, interne: /^internal/.test(kind) });

      if (argsObj && ts.isObjectLiteralExpression(argsObj)) {
        for (const p of argsObj.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const tt = T(p.initializer);
          const a = ajouter({ classe: "arg.fonction", nom: p.name.getText(sf).replace(/["']/g, ""), fichier: rel, ligne: L(p), entite, role: "contrat", typeTexte: tt, porteur: fq, optionnel: /v\.optional\(/.test(tt), vocabulaire: /v\.(union|literal)\(/.test(tt) ? litterauxDe(p.initializer) : null });
          lier(fEl.id, a.id, "attend");
        }
      }
      if (handler) {
        pile.push({ fq, id: fEl.id, kind, entite, rel });
        analyserCorps(handler, fEl, entite);
        pile.pop();
        const s = T(handler);
        fEl.verifs = [
          /createHmac|timingSafeEqual|verifySignature|constructEvent/.test(s) ? "signature" : null,
          /process\.env\.[A-Z_]*(SECRET|TOKEN|KEY)\b/.test(s) && /!==|===/.test(s) ? "secret" : null,
          /getUserIdentity|orgCourante|requireAdmin|requireUser/.test(s) ? "session" : null,
        ].filter(Boolean);
      }
      return true;
    }

    /* Les fonctions serveur qui ne sont pas du Convex : une procédure tRPC en est une,
       au même titre qu'un `export const lister = query({…})`. L'adaptateur dit laquelle. */
    function visiterFonctionServeurAdaptee(nd) {
      const api = { ts, sf, T, C, L, rel, ajouter, lier, litterauxDe, population, analyserCorps, pile, etat };
      for (const a of ADAPTATEURS) {
        if (a.fonctionServeur && a.fonctionServeur(nd, api)) return true;
      }
      return false;
    }

    function visiterHttpRoute(nd) {
      if (!ts.isCallExpression(nd) || !/http\.route$/.test(C(nd.expression))) return false;
      const conf = nd.arguments[0];
      if (!conf || !ts.isObjectLiteralExpression(conf)) return false;
      let chemin = "?", methode = "?", handler = null;
      for (const p of conf.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const k = p.name.getText(sf);
        if (k === "path" && ts.isStringLiteral(p.initializer)) chemin = p.initializer.text;
        if (k === "method" && ts.isStringLiteral(p.initializer)) methode = p.initializer.text;
        if (k === "handler") handler = p.initializer;
      }
      const fEl = ajouter({ classe: "fonction.serveur", nom: `${methode} ${chemin}`, fichier: rel, ligne: L(nd), entite: chemin.split("/").filter(Boolean).pop(), role: "action", kind: "httpActionConvex", fq: `http:${chemin}:${methode}`, pop: null, methode, chemin });
      if (handler) {
        pile.push({ fq: fEl.fq, id: fEl.id, kind: "httpActionConvex", entite: fEl.entite, rel });
        analyserCorps(handler, fEl, fEl.entite);
        pile.pop();
        const s = T(handler);
        fEl.verifs = [
          /createHmac|timingSafeEqual|verifySignature|constructEvent/.test(s) ? "signature" : null,
          /process\.env\.[A-Z_]*(SECRET|TOKEN|KEY)\b/.test(s) && /!==|===/.test(s) ? "secret" : null,
          /getUserIdentity|orgCourante|requireAdmin/.test(s) ? "session" : null,
        ].filter(Boolean);
      }
      return true;
    }

    function visiterRouteNext(nd) {
      if (!/[\\/]route\.(ts|js)$/.test(rel) || !ts.isFunctionDeclaration(nd) || !nd.name || !nd.body) return false;
      const m = T(nd.name);
      if (!/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(m)) return false;
      const chemin = "/" + path.dirname(rel).replace(/\\/g, "/").replace(/^(src\/)?app\//, "");
      const fEl = ajouter({ classe: "fonction.serveur", nom: `${m} ${chemin}`, fichier: rel, ligne: L(nd), entite: path.basename(path.dirname(rel)), role: "action", kind: "routeNext", fq: `${chemin}:${m}`, pop: null, methode: m, chemin });
      pile.push({ fq: fEl.fq, id: fEl.id, kind: "routeNext", entite: fEl.entite, rel });
      analyserCorps(nd, fEl, fEl.entite);
      pile.pop();
      const s = T(nd);
      fEl.verifs = [
        /createHmac|timingSafeEqual|verifySignature|constructEvent|webhookSignature/.test(s) ? "signature" : null,
        /process\.env\.[A-Z_]*(SECRET|TOKEN|KEY)\b|authorization/i.test(s) ? "secret" : null,
        /getAuth|currentUser|auth\(\)/.test(s) ? "session" : null,
      ].filter(Boolean);
      return true;
    }

    // Le vrai travail (écritures, gardes) vit souvent dans un helper partagé que
    // les enveloppes query/mutation ne font qu'appeler. L'ignorer, c'est croire
    // qu'une table n'est jamais écrite alors qu'elle l'est par le cœur commun.
    const dejaVues = new Set();
    /* Une Server Action est une PORTE, pas du cœur commun : elle est joignable depuis le
       navigateur où qu'elle vive (dans `src/actions/`, ou dans un `actions.ts` d'écran).
       La reconnaître
       comme fonction interne la sortait du graphe des unités exposées, donc de toute
       question sur la garde, l'argument et l'accord avec l'écran. */
    const actionServeur = /^\s*["']use server["']/m.test(texte);
    function visiterFonctionOrdinaire(nd) {
      if (!actionServeur && !/^(src[\\/])?(convex|lib|server|actions)[\\/]/.test(rel)) return false;
      let nom = null, corps = null;
      if (ts.isFunctionDeclaration(nd) && nd.name && nd.body) { nom = T(nd.name); corps = nd.body; }
      else if (ts.isVariableDeclaration(nd) && nd.initializer && ts.isIdentifier(nd.name) && (ts.isArrowFunction(nd.initializer) || ts.isFunctionExpression(nd.initializer))) { nom = nd.name.text; corps = nd.initializer.body; }
      if (!nom || !corps || /^[A-Z]/.test(nom) || dejaVues.has(nom)) return false;
      dejaVues.add(nom);
      const fq = `${rel.replace(/\.tsx?$/, "").replace(/^(src\/)?convex\//, "")}::${nom}`;
      const fEl = ajouter({ classe: actionServeur ? "fonction.serveur" : "fonction.interne", nom, fichier: rel, ligne: L(nd), entite: null, role: actionServeur ? "action" : "coeur", kind: actionServeur ? "serverAction" : "interne", fq, pop: population(corps), interne: !actionServeur });
      fEl.entite = fEl.pop.tables[0] || null;
      pile.push({ fq, id: fEl.id, kind: "interne", entite: fEl.entite, rel });
      analyserCorps(corps, fEl, fEl.entite);
      pile.pop();
      return true;
    }

    // --------------------------------------------------------------- écran
    const liaisons = new Map();      // variable -> { fq, chemin }
    const corpsLocaux = new Map();   // fonction locale -> son texte

    function proprietaireJsx(nd) {
      let p = nd;
      while (p) {
        if (ts.isJsxSelfClosingElement(p) || ts.isJsxOpeningElement(p)) return `${rel}#${p.getStart(sf)}`;
        if (ts.isJsxElement(p)) return `${rel}#${p.openingElement.getStart(sf)}`;
        p = p.parent;
      }
      return null;
    }
    function libelleAncetre(nd) {
      let p = nd, prof = 0;
      while (p && prof < 6) {
        const ouv = ts.isJsxElement(p) ? p.openingElement : ts.isJsxSelfClosingElement(p) ? p : null;
        if (ouv) {
          for (const a of ouv.attributes.properties) {
            if (!ts.isJsxAttribute(a) || !/^(label|titre|title|libelle|legende|name)$/.test(a.name.getText(sf))) continue;
            const i = a.initializer;
            if (i && ts.isStringLiteral(i)) return i.text;
            if (i && ts.isJsxExpression(i) && i.expression && ts.isStringLiteral(i.expression)) return i.expression.text;
          }
          prof++;
        }
        p = p.parent;
      }
      return null;
    }

    function visiterEcran(nd) {
      // valeur écrite en dur dans un champ de saisie : le cas « Sophie Martin ».
      if (ts.isJsxAttribute(nd) && /^(defaultValue|value|defaultChecked)$/.test(nd.name.getText(sf))) {
        const i = nd.initializer;
        const lit = i && ts.isStringLiteral(i) ? i.text : i && ts.isJsxExpression(i) && i.expression && ts.isStringLiteral(i.expression) ? i.expression.text : null;
        if (lit && lit.length && lit.length < 120 && !/^[-—…·•\s]*$/.test(lit)) {
          ajouter({ classe: "valeur.endur", nom: libelleAncetre(nd) || lit, fichier: rel, ligne: L(nd), role: "consommateur", porteur: porteur()?.fq, valeur: lit, libelle: libelleAncetre(nd), carte: proprietaireJsx(nd), attribut: nd.name.getText(sf) });
        }
      }

      if (ts.isCallExpression(nd)) {
        const cible = C(nd.expression);
        /* En Convex, le hook nomme sa cible en argument : `useQuery(api.biens.lister)`.
           En tRPC, la cible EST le chemin d'accès et le hook est le dernier maillon :
           `trpc.leads.lister.useQuery()`. Sans cette forme, l'écran et la procédure ne
           sont jamais reliés, et aucun désaccord écran ↔ donnée ne peut se prouver. */
        const refTrpc = cible.match(/^trpc\.([\w.]+)\.(useQuery|useMutation|useSuspenseQuery|useInfiniteQuery|query|mutate)$/);
        if (/^(useQuery|useMutation|useAction|usePaginatedQuery|preloadQuery|fetchQuery)$/.test(cible) || refTrpc) {
          const ref = refTrpc ? [null, refTrpc[1]]
            : nd.arguments[0] ? T(nd.arguments[0]).match(/api\.([\w.]+)/) : null;
          const a = ajouter({ classe: "appel", nom: ref ? ref[1] : T(nd.arguments[0] || nd).slice(0, 60), fichier: rel, ligne: L(nd), entite: ref ? ref[1].split(".")[0] : null, role: "chaine", hook: cible, fqCible: ref ? ref[1] : null, porteur: porteur()?.fq });
          const args = nd.arguments[1];
          if (args && ts.isObjectLiteralExpression(args)) for (const p of args.properties) {
            const k = ts.isPropertyAssignment(p) ? p.name.getText(sf) : ts.isShorthandPropertyAssignment(p) ? p.name.text : null;
            if (!k) continue;
            const el = ajouter({ classe: "arg.appel", nom: k.replace(/["']/g, ""), fichier: rel, ligne: L(p), entite: ref ? ref[1].split(".")[0] : null, role: "contrat", porteur: ref ? ref[1] : null, formule: ts.isPropertyAssignment(p) ? T(p.initializer).slice(0, 120) : k });
            lier(a.id, el.id, "passe");
          }
        }
        if (cible === "fetch") {
          const u = nd.arguments[0] ? T(nd.arguments[0]).replace(/["'`]/g, "") : "";
          ajouter({ classe: "route.appelee", nom: u.slice(0, 130), fichier: rel, ligne: L(nd), entite: null, role: "chaine", externe: /^https?:/.test(u), porteur: porteur()?.fq });
        }
        if (/localStorage\.(setItem|getItem)$/.test(cible)) {
          ajouter({ classe: "stockage.local", nom: T(nd.arguments[0] || nd).replace(/["'`]/g, "").slice(0, 80), fichier: rel, ligne: L(nd), role: "ecriture", porteur: porteur()?.fq });
        }
      }

      if (ts.isJsxExpression(nd) && nd.expression) {
        const s = T(nd.expression);
        const accs = [];
        (function w(x) {
          if (ts.isPropertyAccessExpression(x) && !/^(process|window|document|Math|Object|React|console)\b/.test(T(x))) accs.push(x);
          ts.forEachChild(x, w);
        })(nd.expression);
        const vus = new Set();
        for (const acc of accs) {
          const ch = T(acc);
          if ([...vus].some((v2) => v2.startsWith(ch) && v2 !== ch)) continue;
          vus.add(ch);
          const nom = acc.name.getText(sf);
          if (/^(map|filter|length|toLocaleDateString|toISOString|then|_id|toFixed|slice)$/.test(nom)) continue;
          ajouter({ classe: "champ.affiche", nom, fichier: rel, ligne: L(nd), entite: null, role: "consommateur", porteur: porteur()?.fq, formule: s.slice(0, 170), chaineAcces: ch, carte: proprietaireJsx(nd) });
        }
      }

      // Un DÉCOMPTE affiché (`{semaine.length}` sous un libellé) promet une liste.
      if (ts.isJsxExpression(nd) && nd.expression && /^[A-Za-z_$][\w$]*\.length$/.test(T(nd.expression).trim())) {
        const v = T(nd.expression).trim().split(".")[0];
        ajouter({ classe: "decompte.affiche", nom: libelleAncetre(nd) || `${v}.length`, fichier: rel, ligne: L(nd),
          role: "consommateur", porteur: porteur()?.fq, variable: v, libelle: libelleAncetre(nd), carte: proprietaireJsx(nd) });
      }
      // Le DÉTAIL de cette liste, quand il écarte des lignes. On ne retient que les
      // écarts portant sur une propriété de la ligne elle-même (`visite.annulee`) :
      // un filtre de recherche ou d'onglet n'est pas une redéfinition du décompte.
      const PRED_LIGNE = /^!?\s*[a-z][\w$]*\.[A-Za-z_$][\w$]*$/;
      if (ts.isForOfStatement(nd) && nd.expression) {
        const racine = T(nd.expression).split(/[.[(?\s]/)[0].trim();
        const corps = nd.statement;
        if (racine && ts.isBlock(corps)) for (const st of corps.statements) {
          if (!ts.isIfStatement(st) || !st.thenStatement) continue;
          const suite = ts.isBlock(st.thenStatement) ? st.thenStatement.statements[0] : st.thenStatement;
          if (!suite || (!ts.isContinueStatement(suite) && !ts.isBreakStatement(suite))) continue;
          const p = T(st.expression).replace(/\s+/g, "");
          if (!PRED_LIGNE.test(p)) continue;
          ajouter({ classe: "filtrage.liste", nom: racine, fichier: rel, ligne: L(st), role: "consommateur",
            porteur: porteur()?.fq, variable: racine, predicat: p, forme: "continue" });
        }
      }
      if (ts.isCallExpression(nd) && ts.isPropertyAccessExpression(nd.expression) &&
          nd.expression.name.getText(sf) === "filter" && nd.arguments[0]) {
        const racine = T(nd.expression.expression).split(/[.[(?\s]/)[0].trim();
        const cb = nd.arguments[0];
        const corps = (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.body && !ts.isBlock(cb.body) ? T(cb.body).replace(/\s+/g, "") : null;
        if (racine && corps && PRED_LIGNE.test(corps))
          ajouter({ classe: "filtrage.liste", nom: racine, fichier: rel, ligne: L(nd), role: "consommateur",
            porteur: porteur()?.fq, variable: racine, predicat: corps, forme: "filter" });
      }

      if (ts.isJsxText(nd)) {
        const t = nd.text.trim();
        if (t && t.length > 1 && t.length < 80 && /[A-Za-zÀ-ÿ]/.test(t)) ajouter({ classe: "libelle.ui", nom: t, fichier: rel, ligne: L(nd), role: "libelle", porteur: porteur()?.fq });
      }
      if (ts.isJsxAttribute(nd) && nd.initializer) {
        const attr = nd.name.getText(sf);
        const i = nd.initializer;
        if (ts.isStringLiteral(i)) {
          if (/^(placeholder|title|alt|aria-label|label|titre|libelle|precision|legende)$/.test(attr)) ajouter({ classe: "libelle.ui", nom: i.text, fichier: rel, ligne: L(nd), role: "libelle", porteur: porteur()?.fq, attribut: attr });
          if (attr === "href") ajouter({ classe: "navigation", nom: i.text, fichier: rel, ligne: L(nd), role: "navigation", porteur: porteur()?.fq, carte: proprietaireJsx(nd) });
        } else if (ts.isJsxExpression(i) && i.expression) {
          if (attr === "href") ajouter({ classe: "navigation", nom: T(i.expression).replace(/[`${}"']/g, "").slice(0, 90), fichier: rel, ligne: L(nd), role: "navigation", porteur: porteur()?.fq, dynamique: true, carte: proprietaireJsx(nd) });
          if (/^(titre|title|label|libelle|precision)$/.test(attr) && ts.isStringLiteral(i.expression)) ajouter({ classe: "libelle.ui", nom: i.expression.text, fichier: rel, ligne: L(nd), role: "libelle", porteur: porteur()?.fq, attribut: attr });
        }
      }

      if (ts.isJsxElement(nd) && T(nd.openingElement.tagName) === "button") {
        const texte = nd.children.map((c) => ts.isJsxText(c) ? c.text : ts.isJsxExpression(c) ? T(c) : "").join(" ").trim();
        const h = nd.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && /^(onClick|onSubmit)$/.test(a.name.getText(sf)));
        let corps = h && h.initializer ? T(h.initializer) : "";
        if (!corps) {
          // un bouton de soumission hérite du geste du formulaire qui le contient
          let p = nd.parent;
          while (p && !(ts.isJsxElement(p) && /^form$/i.test(T(p.openingElement.tagName)))) p = p.parent;
          if (p) {
            const os = p.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "onSubmit");
            if (os && os.initializer) corps = T(os.initializer);
          }
        }
        ajouter({
          classe: "action.ui", nom: (texte || "bouton").replace(/\s+/g, " ").slice(0, 60), fichier: rel, ligne: L(nd),
          role: "action", porteur: porteur()?.fq, formule: corps.replace(/\s+/g, " ").slice(0, 400),
          mutations: [
            ...[...corps.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
            ...(/^\{?\s*[a-zA-Z_$][\w$]*\s*\}?$/.test(corps.trim()) ? [corps.replace(/[{}\s]/g, "")] : []),  // onClick={save}
          ],
        });
      }

      // `donnee ?? CONSTANTE` : un repli qui n'est pas neutre est une donnée
      // fabriquée. On note l'endroit ; c'est l'accord sur la SOURCE qui tranchera.
      if (ts.isBinaryExpression(nd) &&
          (nd.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || nd.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
          ts.isIdentifier(nd.right) && /^[A-Z][A-Z0-9_]{2,}$/.test(nd.right.text)) {
        const g = T(nd.left);
        ajouter({ classe: "repli.endur", nom: nd.right.text, fichier: rel, ligne: L(nd), role: "consommateur",
          porteur: porteur()?.fq, gauche: g.slice(0, 80), racine: g.split(/[.[(?!]/)[0].trim() });
      }

      if (ts.isVariableDeclaration(nd) && nd.initializer && ts.isIdentifier(nd.name) && /^[A-Z][A-Z0-9_]+$/.test(nd.name.text) &&
          (ts.isArrayLiteralExpression(nd.initializer) || ts.isObjectLiteralExpression(nd.initializer))) {
        let premier = null;
        (function p1(x) { if (!premier && ts.isObjectLiteralExpression(x)) premier = x; else ts.forEachChild(x, p1); })(nd.initializer);
        ajouter({ classe: "constante.endur", nom: nd.name.text, fichier: rel, ligne: L(nd), role: "donnee",
          porteur: porteur()?.fq,
          cles: premier ? premier.properties.map((q) => q.name ? q.name.getText(sf).replace(/["']/g, "") : null).filter(Boolean) : [],
          taille: ts.isArrayLiteralExpression(nd.initializer) ? nd.initializer.elements.length : 1,
          chiffres: /\b\d[\d_]*(\.\d+)?\b/.test(T(nd.initializer)) });
        (function w(x) {
          if (ts.isPropertyAssignment(x) && ts.isStringLiteral(x.initializer)) {
            const k = x.name.getText(sf);
            if (/^(cle|key|value|valeur|statut|status|id|slug|href)$/.test(k)) ajouter({ classe: "litteral.vocabulaire", nom: x.initializer.text, fichier: rel, ligne: L(x), role: "vocabulaire", porteur: nd.name.text, champCible: k, usage: "constante" });
            else if (/^(libelle|label|titre|title|nom)$/.test(k)) ajouter({ classe: "libelle.ui", nom: x.initializer.text, fichier: rel, ligne: L(x), role: "libelle", porteur: nd.name.text });
          }
          ts.forEachChild(x, w);
        })(nd.initializer);
      }

      if (ts.isPropertyAssignment(nd) && ts.isStringLiteral(nd.initializer) && nd.parent && ts.isObjectLiteralExpression(nd.parent) && nd.parent.parent && ts.isCallExpression(nd.parent.parent)) {
        ajouter({ classe: "litteral.vocabulaire", nom: nd.initializer.text, fichier: rel, ligne: L(nd), role: "vocabulaire", porteur: porteur()?.fq || T(nd.parent.parent.expression), champCible: nd.name.getText(sf).replace(/["']/g, ""), usage: "argument" });
      }
    }

    function visiterComposant(nd) {
      if ((ts.isFunctionDeclaration(nd) || ts.isVariableDeclaration(nd)) && nd.name) {
        const nom = T(nd.name);
        if (/^[A-Z]/.test(nom)) { ajouter({ classe: "composant", nom, fichier: rel, ligne: L(nd), role: "consommateur", entite: null }); return { fq: `${rel}:${nom}` }; }
      }
      return null;
    }

    // pré-passes
    (function prep(nd) {
      if (ts.isPropertyAssignment(nd)) {
        const m = T(nd.initializer).match(/v\.id\(["']([^"']+)["']\)/);
        if (m) argsTables.set(`*.${nd.name.getText(sf)}`, m[1]);
      }
      ts.forEachChild(nd, prep);
    })(sf);

    // Provenance : quelle variable d'écran vient de quelle fonction serveur.
    // Sans ça, « l.derniereActivite » est un nom flottant ; avec ça, c'est un
    // consommateur de leads.liste dont on peut demander des comptes au producteur.
    (function prov(nd) {
      if (ts.isVariableDeclaration(nd) && nd.initializer && ts.isIdentifier(nd.name) && ts.isCallExpression(nd.initializer)) {
        const c = C(nd.initializer.expression);
        const rt = c.match(/^trpc\.([\w.]+)\.(useQuery|useMutation|useSuspenseQuery|useInfiniteQuery)$/);
        if (/^(useQuery|useMutation|useAction|usePaginatedQuery)$/.test(c) || rt) {
          const ref = rt ? [null, rt[1]] : T(nd.initializer).match(/api\.([\w.]+)/);
          // `const leads = trpc.leads.lister.useQuery()` : la donnée est sous `.data`,
          // pas à la racine, sinon `leads.data.map(…)` ne se relie à rien.
          if (ref) liaisons.set(nd.name.text, { fq: ref[1], chemin: "", hook: rt ? rt[2] : c, sousData: !!rt });
        }
      }
      if (ts.isVariableDeclaration(nd) && nd.initializer && ts.isIdentifier(nd.name) && (ts.isArrowFunction(nd.initializer) || ts.isFunctionExpression(nd.initializer))) corpsLocaux.set(nd.name.text, T(nd.initializer));
      if (ts.isFunctionDeclaration(nd) && nd.name && nd.body) corpsLocaux.set(T(nd.name), T(nd.body));
      if (ts.isCallExpression(nd) && /\.map$/.test(C(nd.expression))) {
        const objTexte = C(nd.expression).replace(/\.map$/, "");
        const racine = objTexte.split(/[.[(]/)[0];
        const base = liaisons.get(racine);
        const cb = nd.arguments[0];
        if (base && cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name)) {
          liaisons.set(cb.parameters[0].name.text, { fq: base.fq, chemin: objTexte.slice(racine.length).replace(/^\./, ""), hook: base.hook });
        }
      }
      ts.forEachChild(nd, prov);
    })(sf);

    (function visiter(nd) {
      visiterSchema(nd);
      if (visiterFonctionServeur(nd) || visiterFonctionServeurAdaptee(nd)) { ts.forEachChild(nd, visiter); return; }
      if (visiterRouteNext(nd)) return;
      if (visiterHttpRoute(nd)) return;
      if (visiterFonctionOrdinaire(nd)) return;
      const comp = visiterComposant(nd);
      if (comp) pile.push(comp);
      visiterEcran(nd);
      ts.forEachChild(nd, visiter);
      if (comp) pile.pop();
    })(sf);

    // ------------------------------------------- résolution et dédoublonnage
    const miens = elements.filter((e) => e.fichier === rel);
    for (const e of miens) {
      if (e.classe === "champ.affiche" && e.chaineAcces) {
        const racine = e.chaineAcces.split(".")[0];
        const b = liaisons.get(racine);
        if (b) { e.fqSource = b.fq; e.entite = b.fq.split(".")[0]; e.cheminSource = [b.chemin, e.chaineAcces.slice(racine.length + 1)].filter(Boolean).join("."); }
      }
      if (e.classe === "repli.endur" && liaisons.has(e.racine)) e.fqSource = liaisons.get(e.racine).fq;
      if ((e.classe === "decompte.affiche" || e.classe === "filtrage.liste") && liaisons.has(e.variable)) e.fqSource = liaisons.get(e.variable).fq;
      if (e.classe === "action.ui") {
        const vus = new Set();
        const atteints = (noms, prof) => {
          let r = [];
          for (const m of noms) {
            if (vus.has(m) || prof > 2) continue;
            vus.add(m);
            if (liaisons.has(m)) { r.push(liaisons.get(m).fq); continue; }
            const c = corpsLocaux.get(m);
            if (c) r = r.concat(atteints([...c.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((x) => x[1]), prof + 1));
          }
          return r;
        };
        e.mutationsFq = [...new Set(atteints(e.mutations || [], 0))];
        e.ecritServeur = e.mutationsFq.length > 0;
        e.delegue = [...vus].some((m) => /^on[A-Z]/.test(m));
        e.sortReseau = (e.mutations || []).some((m) => /fetch\s*\(|axios|\$fetch/.test(corpsLocaux.get(m) || "")) || /fetch\s*\(/.test(e.formule || "");
        // ce que le geste appelle et qu'on ne sait PAS résoudre : motif d'abstention
        e.inconnus = (e.mutations || []).filter((m) => !liaisons.has(m) && !corpsLocaux.has(m) &&
          !/^(set[A-Z]|toast|alert|notify|confirm|console|void|Number|String|Boolean|JSON|Math|Date|Promise|window|document|e|preventDefault|stopPropagation|then|catch|map|filter|require)/.test(m));
        const etendu = (e.formule || "") + " " + (e.mutations || []).map((m) => corpsLocaux.get(m) || "").join(" ");
        const an = etendu.match(/\b(toast|alert|notify|setRetour|setMessage|setStatut|setFeedback|success)\s*\(\s*["'`]([^"'`]{3,80})/);
        e.annonceSucces = an ? an[2] : null;
        e.ouvreQuelqueChose = /\bset[A-Z]\w*\(|\bopen|\bshow|\bouvrir|router\.push/.test(e.formule || "");
      }
    }
    // un même accès affiché est capté à chaque niveau de JSX imbriqué :
    // on ne garde que l'occurrence la plus profonde (la formule la plus courte).
    const parAcces = new Map();
    for (const e of miens) {
      if (e.classe !== "champ.affiche") continue;
      const k = `${e.porteur}|${e.chaineAcces}`;
      const p = parAcces.get(k);
      if (!p || (e.formule || "").length < (p.formule || "").length) parAcces.set(k, e);
    }
    const gardes = new Set([...parAcces.values()].map((e) => e.id));
    for (let i = elements.length - 1; i >= 0; i--) {
      const e = elements[i];
      if (e.fichier === rel && e.classe === "champ.affiche" && !gardes.has(e.id)) elements.splice(i, 1);
    }
  }

  return { elements, aretes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const racine = path.resolve(process.argv[2] || ".");
  const t0 = Date.now();
  const r = extraire(racine);
  const i = process.argv.indexOf("--out");
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(r, null, 1));
  const pc = {};
  for (const e of r.elements) pc[e.classe] = (pc[e.classe] || 0) + 1;
  console.log(`éléments: ${r.elements.length}  arêtes: ${r.aretes.length}  (${Date.now() - t0} ms)`);
  for (const [k, v] of Object.entries(pc).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}

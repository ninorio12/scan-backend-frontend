/**
 * extraction-sql.mjs — ce que « une table », « une lecture », « une écriture » veulent
 * dire en Prisma, Drizzle, Supabase et SQL brut.
 *
 * LE TABLEAU DES ÉQUIVALENCES (celui du chantier `banc/stacks/`)
 *
 *   Convex                         Prisma                  Drizzle                     Supabase
 *   defineTable({…})               model Lead { … }        pgTable("leads", {…})       create table leads (…)
 *   ctx.db.query("biens")          prisma.lead.findMany    db.select().from(leads)     .from("leads").select()
 *   .withIndex() .take()           where / take            .where() .limit()           .eq() .limit()
 *   ctx.db.insert("biens", {…})    prisma.lead.create      db.insert(leads).values     .from("leads").insert
 *   ctx.db.patch(id, {…})          prisma.lead.update      db.update(leads).set        .from("leads").update
 *   ctx.db.delete(id)              prisma.lead.delete      db.delete(leads)            .from("leads").delete
 *
 * TROIS DIFFICULTÉS, ET CE QU'ON EN FAIT
 *
 * 1. Le schéma vit AILLEURS que les requêtes (`prisma/schema.prisma`, `drizzle/schema.ts`,
 *    `supabase/migrations/*.sql`). D'où la pré-passe : il faut connaître les tables avant
 *    de lire la première requête, sinon l'ordre alphabétique décide de ce qu'on comprend.
 * 2. Prisma met le modèle en minuscule dans le client : `model Lead` → `prisma.lead`.
 *    Sans réconciliation, la table lue et la table écrite portent deux noms.
 * 3. Drizzle met TROIS noms sur une table : la constante (`leads`), le nom SQL
 *    (`"leads"`), et un nom par champ des deux côtés (`montantHT` / `montant_ht`). On
 *    garde le nom SQL pour la table et le nom TypeScript pour les champs : c'est ce que
 *    l'humain lit dans le code, et c'est ce qui se rapproche des écrans.
 */

/** Prisma appelle `prisma.lead` ce que le schéma nomme `Lead`. */
function resoudreTable(nom, connues) {
  if (connues.has(nom)) return nom;
  for (const k of connues.keys()) if (k.toLowerCase() === String(nom).toLowerCase()) return k;
  return nom;
}

/* Les clients qui portent un `.from(…)` de base de données. Sert à ne pas prendre
   `Array.from(x)` ni `Object.fromEntries` pour une lecture de table. */
const CLIENT_SQL = /(^|\.)(supabase\w*|sb|db|client|knex|sql|conn|pool|database|admin\w*)\.from$/i;

export default {
  nom: 'sql',

  /* ── Les schémas qui ne sont pas du TypeScript, plus celui de Drizzle qui l'est ── */
  prePasse({ fichiers, fs, path, racine, ajouter, lier, etat }) {
    for (const fp of fichiers) {
      let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch { continue; }
      const rel = path.relative(racine, fp);
      const ligneDe = (i) => txt.slice(0, i).split('\n').length;

      // Prisma : model Lead { … }, et les enum qui donnent le vocabulaire fermé.
      const enums = new Map();
      for (const e of txt.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm))
        enums.set(e[1], [...e[2].matchAll(/^\s*(\w+)\s*$/gm)].map((y) => y[1]));
      const modeles = new Set([...txt.matchAll(/^model\s+(\w+)/gm)].map((x) => x[1]));
      for (const m of txt.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        etat.tables.set(m[1], {
          source: rel, ligne: ligneDe(m.index), saveur: 'prisma',
          champs: [...m[2].matchAll(/^\s*(\w+)\s+([\w[\]]+)(\??)([^\n]*)/gm)]
            .filter((x) => !/^@@/.test(x[1]))
            // `lead Lead @relation(…)` et `factures Facture[]` ne sont pas des colonnes :
            // ce sont des liens. Les compter comme champs faisait dire « Facture.lead est
            // lu et jamais écrit » sur un champ qui n'existe pas en base.
            .filter((x) => !modeles.has(x[2].replace(/\[\]$/, '')) && !/@relation/.test(x[4]))
            .map((x) => ({
              nom: x[1], typeTexte: x[2] + x[3],
              // Un champ à valeur par défaut n'a pas à être écrit par l'application :
              // l'exiger fabrique un désaccord là où la base fait son travail.
              optionnel: x[3] === '?' || /@default\(/.test(x[4]),
              defaut: (x[4].match(/@default\(([^)]*)\)/) || [])[1] || false,
              vocabulaire: enums.get(x[2]) || null,
            })),
        });
      }

      // Drizzle : export const leads = pgTable("leads", { … })
      for (const m of txt.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\(\s*["'`](\w+)["'`]\s*,\s*\{([\s\S]*?)\n\}\s*\)/g)) {
        etat.alias.set(m[1], m[2]);
        etat.tables.set(m[2], {
          source: rel, ligne: ligneDe(m.index), alias: m[1], saveur: 'drizzle',
          champs: [...m[3].matchAll(/^\s*(\w+)\s*:\s*([^\n]*)/gm)].map((x) => ({
            nom: x[1], typeTexte: x[2].trim().slice(0, 120),
            optionnel: !/\.notNull\(\)/.test(x[2]) || /\.default\w*\(/.test(x[2]),
            defaut: (x[2].match(/\.(default\w*)\(([^)]*)\)/) || [])[0] || false,
            // text("statut", { enum: ["NOUVEAU", …] }) : un vocabulaire fermé, comme
            // v.union(v.literal(…)) en Convex. C'est ce qui permet de dire qu'un
            // littéral écrit ailleurs est hors vocabulaire.
            vocabulaire: /enum\s*:/.test(x[2]) ? [...x[2].matchAll(/["'`]([^"'`]+)["'`]/g)].map((y) => y[1]).slice(1) : null,
          })),
        });
      }

      // SQL brut : create table leads ( … )
      for (const m of txt.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public\.)?(\w+)["`]?\s*\(([\s\S]*?)\n\)\s*;/gi)) {
        if (etat.tables.has(m[1])) continue;
        const corps = m[2];
        const vocabulaires = new Map();
        for (const c of corps.matchAll(/check\s*\(\s*(\w+)\s+in\s*\(([^)]*)\)/gi))
          vocabulaires.set(c[1], [...c[2].matchAll(/'([^']+)'/g)].map((y) => y[1]));
        etat.tables.set(m[1], {
          source: rel, ligne: ligneDe(m.index), saveur: 'sql',
          champs: [...corps.matchAll(/^\s*(\w+)\s+(uuid|text|varchar|char|integer|int|bigint|boolean|bool|timestamptz|timestamp|numeric|decimal|real|double|jsonb|json|date|serial)\b([^\n,]*)/gim)]
            .map((x) => ({
              nom: x[1], typeTexte: x[2],
              optionnel: !/not\s+null/i.test(x[3]) || /default\s/i.test(x[3]),
              defaut: (x[3].match(/default\s+([^\s,]+)/i) || [])[1] || false,
              vocabulaire: vocabulaires.get(x[1]) || null,
            })),
        });
      }
    }

    for (const [nom, t] of etat.tables) {
      const tEl = ajouter({ classe: 'table', nom, fichier: t.source, ligne: t.ligne, entite: nom, role: 'stockage' });
      for (const c of t.champs || []) {
        const el = ajouter({
          classe: 'champ.schema', nom: c.nom, fichier: t.source, ligne: t.ligne, entite: nom, role: 'stockage',
          typeTexte: c.typeTexte, optionnel: !!c.optionnel, vocabulaire: c.vocabulaire || null,
          source: `${nom}.${c.nom}`, defaut: !!c.defaut,
        });
        lier(tEl.id, el.id, 'contient');
        /* UN CHAMP À VALEUR PAR DÉFAUT EST ÉCRIT : par la base, pas par l'application.
           Sans le dire, chaque `@default(now())` et chaque `default false` ressortait en
           « lu partout, écrit par personne, les lecteurs liront toujours vide » — ce qui
           est faux, et ce que Convex n'a pas puisqu'il n'a pas de valeur par défaut. */
        if (c.defaut) ajouter({
          classe: 'champ.ecrit', nom: c.nom, fichier: t.source, ligne: t.ligne, entite: nom,
          role: 'ecriture', porteur: null, formule: c.defaut === true ? 'défaut de la base' : String(c.defaut),
          source: `${nom}.${c.nom}`, operation: 'default',
        });
      }
    }
  },

  lecture(cible, x, api) {
    const { ts, T, pop, etat } = api;
    if (!etat.tables.size) return;   // aucun schéma SQL : ne rien inventer

    const mp = cible.match(/^(?:\w+\.)?prisma\.([A-Za-z_$][\w$]*)\.(findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy)$/);
    if (mp) pop.tables.push(resoudreTable(mp[1], etat.tables));

    if (/(^|\.)from$/.test(cible) && x.arguments[0]) {
      const a = x.arguments[0];
      // Drizzle désigne la constante, Supabase la chaîne. `Array.from(…)` ne désigne rien.
      if (ts.isIdentifier(a) && etat.alias.has(a.text)) pop.tables.push(etat.alias.get(a.text));
      else if (ts.isStringLiteral(a) && (etat.tables.has(a.text) || CLIENT_SQL.test(cible))) pop.tables.push(a.text);
    }

    if (/\.limit$/.test(cible)) pop.bornes.push(`limit:${T(x.arguments[0] || x)}`);
    if (/\.range$/.test(cible)) pop.bornes.push(`range:${T(x.arguments[0] || x)}`);
    if (/\.single$/.test(cible)) pop.bornes.push('unique');
    if (/\.where$/.test(cible)) pop.bornes.push(`where:${T(x.arguments[0] || x).slice(0, 60)}`);
  },

  ecriture(cible, x, api) {
    const { ts, sf, T, L, rel, ajouter, lier, etaler, objetsLocaux, fEl, etat } = api;
    if (!etat.tables.size) return false;

    let tbl = null, op = null, donnees = null;

    // Prisma : prisma.lead.create({ data: {…} })
    const mp = cible.match(/^(?:\w+\.)?prisma\.([A-Za-z_$][\w$]*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/);
    if (mp) {
      tbl = resoudreTable(mp[1], etat.tables); op = mp[2];
      const conf = x.arguments[0];
      if (conf && ts.isObjectLiteralExpression(conf)) {
        for (const p of conf.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          if (!/^(data|create|update)$/.test(p.name.getText(sf))) continue;
          if (ts.isObjectLiteralExpression(p.initializer)) donnees = p.initializer;
        }
      }
    }

    // Drizzle : db.insert(leads).values({…}) — les valeurs sont au maillon SUIVANT.
    const md = cible.match(/(?:^|\.)(insert|update|delete)$/);
    if (!tbl && md && x.arguments[0] && ts.isIdentifier(x.arguments[0]) && etat.alias.has(x.arguments[0].text)) {
      tbl = etat.alias.get(x.arguments[0].text); op = md[1];
      const p = x.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.parent && ts.isCallExpression(p.parent) &&
          /^(values|set)$/.test(p.name.getText(sf)) && p.parent.arguments[0] &&
          ts.isObjectLiteralExpression(p.parent.arguments[0])) donnees = p.parent.arguments[0];
    }

    // Supabase : .from("factures").update({…}) — la table et l'opération sont dans la
    // même chaîne d'appel.
    const ms = cible.match(/\.from\(\s*["'`](\w+)["'`]\s*\)\s*\.(insert|update|upsert|delete)$/);
    if (!tbl && ms) {
      tbl = ms[1]; op = ms[2];
      if (x.arguments[0] && ts.isObjectLiteralExpression(x.arguments[0])) donnees = x.arguments[0];
    }

    if (!tbl || !op) return false;

    const classe = /delete/.test(op) ? 'operation.suppression' : 'operation.ecriture';
    ajouter({ classe, nom: `${op}:${tbl}`, fichier: rel, ligne: L(x), entite: tbl, role: 'ecriture', porteur: fEl.fq });
    if (donnees) {
      for (const p of etaler(ts, sf, donnees, objetsLocaux, T)) {
        if (!p.cle) {
          if (p.opaque) ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ...${p.opaque}`, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture', porteur: fEl.fq });
          continue;
        }
        const el = ajouter({
          classe: 'champ.ecrit', nom: p.cle, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture',
          porteur: fEl.fq, formule: p.formule, source: `${tbl}.${p.cle}`, operation: op,
        });
        lier(fEl.id, el.id, 'ecrit');
      }
    } else if (!/delete/.test(op)) {
      // L'objet écrit n'est pas un littéral : on le dit opaque plutôt que de prétendre
      // savoir quels champs partent en base.
      const obj = x.arguments[0];
      if (obj) ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ${T(obj).slice(0, 40)}`, fichier: rel, ligne: L(x), entite: tbl, role: 'ecriture', porteur: fEl.fq, cles: objetsLocaux.get(T(obj)) || null });
    }
    return true;
  },

  /* `const lignes = await db.select().from(leads)` : la variable porte la table, comme
     `const b = await ctx.db.get(id)` en Convex. */
  variableLocale(x, api) {
    const { ts, T, locales, etat } = api;
    if (!etat.tables.size) return;
    if (!ts.isVariableDeclaration(x) || !x.initializer || !ts.isIdentifier(x.name)) return;
    const s = T(x.initializer).replace(/\s+/g, '');
    const mf = s.match(/\.from\(["'`](\w+)["'`]\)/);
    if (mf && etat.tables.has(mf[1])) { locales.set(x.name.text, mf[1]); return; }
    const md = s.match(/\.from\((\w+)\)/);
    if (md && etat.alias.has(md[1])) { locales.set(x.name.text, etat.alias.get(md[1])); return; }
    const mp = s.match(/prisma\.([A-Za-z_$][\w$]*)\.(findMany|findUnique|findFirst)/);
    if (mp) locales.set(x.name.text, resoudreTable(mp[1], etat.tables));
  },
};

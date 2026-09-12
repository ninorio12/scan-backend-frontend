/**
 * operateurs.mjs — Les opérateurs de plantation de défauts.
 *
 * L'IDÉE CENTRALE DU DOSSIER, et le redémarrage du 11/09 vient de la prouver.
 *
 * Un banc écrit à la main a deux défauts fatals. Le premier : quelqu'un l'a écrit, donc
 * quelqu'un connaît les réponses, donc un agent qui veut faire monter le chiffre peut
 * apprendre le banc au lieu d'apprendre le métier. Le second : c'est un fichier, et un
 * fichier se perd. Le banc de 20 défauts a disparu dans un redémarrage cet après-midi.
 *
 * Ici, le banc n'existe pas avant la mesure. Il est TIRÉ AU SORT à l'instant où on mesure,
 * sur le code réel de nos trois SaaS, par des opérateurs qui prennent la santé et produisent
 * la maladie. Il n'y a rien à perdre : la source, c'est <projet-client-B> et projet client C, qui sont
 * sauvegardés parce que ce sont des produits. Un banc génératif ne se perd pas dans un
 * redémarrage, il se régénère.
 *
 * Chaque opérateur respecte quatre contraintes, sans quoi il est refusé :
 *
 *   1. IL PART DU RÉEL. Le site existe dans un de nos dépôts. Pas un fichier inventé.
 *   2. IL EST SILENCIEUX. La mutation doit passer le compilateur. Un défaut que `tsc`
 *      attrape n'appartient pas au territoire du skill : il est déjà couvert, et l'y
 *      compter gonflerait le rappel pour rien. Le filtre tsc est un juge extérieur.
 *   3. IL EST ANCRÉ. L'opérateur rend le fichier, la ligne et les symboles touchés :
 *      la vérité terrain est produite mécaniquement, pas rédigée.
 *   4. IL EST ÉCRIT DEPUIS LE SYMPTÔME, PAS DEPUIS LE DÉTECTEUR. Le commentaire de chaque
 *      opérateur dit ce que le CLIENT verrait. Aucun n'a le droit de citer un identifiant
 *      de règle (A1, D2…). Un opérateur qui décrirait un détecteur ferait mesurer le
 *      détecteur par lui-même.
 */

const ligneDe = (txt, index) => txt.slice(0, index).split('\n').length;

function sites(txt, re) {
  const out = []; let m; re.lastIndex = 0;
  while ((m = re.exec(txt))) { out.push({ index: m.index, m }); if (!re.global) break; }
  return out;
}

function fonctionEnglobante(txt, index) {
  const avant = txt.slice(0, index);
  const m = [...avant.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=|(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].pop();
  return m ? (m[1] || m[2]) : null;
}

const convexOnly = (f) => /(^|\/)convex\//.test(f.rel) && !/_generated/.test(f.rel);
const uiOnly = (f) => /\.(tsx|jsx)$/.test(f.rel) && !/_generated|node_modules/.test(f.rel);

export const OPERATEURS = [
  {
    id: 'ordre-implicite', famille: 'ORDRE_IMPLICITE',
    symptome: 'l’écran affiche « dernier X » et montre le premier',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /\.order\("desc"\)\s*(?=\.(first|unique|take)\()/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + txt.slice(s.index + s.m[0].length),
      resume: 'tri décroissant retiré avant .first() : la plus ancienne ligne remonte',
    }),
  },
  {
    id: 'filtre-locataire', famille: 'LOCATAIRE',
    symptome: 'les données d’un autre client apparaissent dans la liste',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /\.withIndex\("[A-Za-z0-9_]+",\s*\(q\)\s*=>\s*q\s*\.eq\("(?:clerkUserId|ownerClerkUserId|orgId|userId|accountId|projectId|coachClerkUserId)"[^;]{0,160}?\)\s*\)/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + txt.slice(s.index + s.m[0].length),
      resume: 'index de propriétaire retiré : la requête balaie la table entière, tous locataires confondus',
    }),
  },
  {
    id: 'garde-retiree', famille: 'GARDE_EFFACEE',
    symptome: 'une porte publique accepte un appel sans identité',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /^[ \t]*await\s+(?:require[A-Za-z]*|assert[A-Za-z]*|ensure[A-Za-z]*)\([^;]*\);[ \t]*\r?\n/gm),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + txt.slice(s.index + s.m[0].length),
      resume: 'vérification d’accès supprimée : ' + s.m[0].trim(),
    }),
  },
  {
    id: 'ecriture-volante', famille: 'ECRITURE_VOLANTE',
    symptome: 'la réponse part avant que la base ait écrit',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /\bawait\s+(?=ctx\.db\.(?:patch|insert|replace|delete)\()/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + txt.slice(s.index + s.m[0].length),
      resume: 'await retiré devant une écriture : la mutation rend la main avant que la base ait écrit',
    }),
  },
  {
    id: 'agregat-partiel', famille: 'AGREGAT_PARTIEL',
    symptome: 'le total affiché est celui des 50 premières lignes',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /\.collect\(\)(?=[\s\S]{0,400}?\.(?:reduce|length|filter)\()/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + '.take(50)' + txt.slice(s.index + s.m[0].length),
      resume: 'collect() remplacé par take(50) avant un agrégat : total calculé sur un échantillon',
    }),
  },
  {
    id: 'cible-inexistante', famille: 'CIBLE_INEXISTANTE',
    symptome: 'un bouton appelle une adresse que personne ne sert',
    cible: (f) => /\.(tsx?|jsx?)$/.test(f.rel) && !/_generated/.test(f.rel),
    trouver: (txt) => sites(txt, /(["'`])(\/api\/[A-Za-z0-9\-_/[\]]+)\1/g),
    appliquer: (txt, s) => {
      const chemin = s.m[2];
      const seg = chemin.split('/').filter(Boolean);
      const i = seg.length - 1;
      seg[i] = seg[i].endsWith('s') ? seg[i].slice(0, -1) : seg[i] + 's';
      const neuf = '/' + seg.join('/');
      return {
        texte: txt.slice(0, s.index) + s.m[1] + neuf + s.m[1] + txt.slice(s.index + s.m[0].length),
        resume: `appel réseau dévié : « ${chemin} » devient « ${neuf} », que rien ne sert`,
        extraSymboles: [neuf, chemin],
      };
    },
  },
  {
    id: 'entree-non-validee', famille: 'ENTREE_NON_VALIDEE',
    symptome: 'une porte publique accepte un corps de requête non typé',
    // schema.ts exclu : y relâcher un validateur relâche le schéma, ce n'est pas
    // « une porte publique qui accepte tout ». On ne mute que les blocs `args:`.
    cible: (f) => convexOnly(f) && !/schema\.ts$/.test(f.rel),
    trouver: (txt) => sites(txt, /(?<=args:\s*\{[^}]{0,400})\bv\.(?:string|number|boolean|id)\(([^)]*)\)/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + 'v.any()' + txt.slice(s.index + s.m[0].length),
      resume: 'validateur d’entrée remplacé par v.any() : la porte accepte tout',
    }),
  },
  {
    id: 'vocabulaire-divergent', famille: 'VOCABULAIRE',
    symptome: 'un onglet reste vide à vie : la valeur filtrée n’existe pas au schéma',
    cible: convexOnly,
    trouver: (txt) => sites(txt, /q\.eq\("(?:statut|status|state|etat|kind|type)",\s*"([a-z_]{3,20})"\)/g),
    appliquer: (txt, s) => {
      const v = s.m[1];
      const faux = v.includes('_') ? v.replace('_', '-') : v + 'e';
      return {
        texte: txt.slice(0, s.index) + s.m[0].replace(`"${v}"`, `"${faux}"`) + txt.slice(s.index + s.m[0].length),
        resume: `valeur filtrée « ${v} » remplacée par « ${faux} », absente du vocabulaire du schéma`,
        extraSymboles: [faux],
      };
    },
  },
  {
    id: 'panne-deguisee', famille: 'PANNE_DEGUISEE',
    symptome: 'une panne s’affiche comme un zéro, indiscernable d’un vrai zéro',
    cible: (f) => /\.(tsx?|jsx?)$/.test(f.rel) && !/_generated/.test(f.rel),
    trouver: (txt) => sites(txt, /catch\s*(?:\([^)]*\))?\s*\{\s*(?:console\.(?:error|warn)\([^;]*\);?\s*)?throw\s+[^;]+;/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + s.m[0].replace(/throw\s+[^;]+;/, 'return null;') + txt.slice(s.index + s.m[0].length),
      resume: 'relance d’erreur remplacée par un retour neutre : la panne devient une donnée',
    }),
  },
  {
    id: 'chiffre-fige', famille: 'CHIFFRE_INVENTE',
    symptome: 'un compteur affiche une valeur écrite en dur',
    cible: uiOnly,
    // Uniquement des champs qui SONT des compteurs : remplacer une couleur par 1247
    // ne produit pas un KPI inventé, ça produit un écran cassé.
    trouver: (txt) => sites(txt, /\{(?:data|stats|resume|kpi|metrics|totaux)\??\.[A-Za-z0-9_.?]*(?:[Cc]ount|[Tt]otal|[Nn]ombre|[Mm]ontant|[Ss]core|[Tt]aux|[Ss]um|[Aa]mount|[Nn]b[A-Z])[A-Za-z0-9_.?]*\}/g),
    appliquer: (txt, s) => ({
      texte: txt.slice(0, s.index) + '{1247}' + txt.slice(s.index + s.m[0].length),
      resume: `valeur ${s.m[0]} remplacée par le nombre en dur 1247 dans l’écran`,
      extraSymboles: ['1247'],
    }),
  },
];

export { ligneDe, fonctionEnglobante };

#!/usr/bin/env node
/**
 * inventaire.mjs — L'inventaire exhaustif du produit, et la preuve pour chaque élément.
 *
 * POURQUOI CET OUTIL EXISTE, alors qu'il y a déjà un auditeur.
 *
 * L'auditeur part des bugs : il connaît 23 motifs et les cherche. Son défaut est
 * structurel : le 24e type de problème, celui qu'on n'a pas encore rencontré, il ne le
 * verra pas, et il annoncera « zéro défaut » sur un produit cassé. Une liste de motifs
 * n'est jamais exhaustive, par définition.
 *
 * Celui-ci fait l'inverse. Il énumère TOUT ce que le produit contient — chaque écran,
 * chaque bouton, chaque champ, chaque valeur affichée, chaque fonction, chaque table —
 * et exige pour chacun une PREUVE qu'il est relié à quelque chose. Ce qui n'a pas de
 * preuve n'est pas « sans bug » : il est NON PROUVÉ, et il ressort.
 *
 * La différence est celle du dénominateur. L'auditeur dit « j'ai trouvé 12 problèmes ».
 * Celui-ci dit « voici les 1 843 éléments de ton produit, j'en ai prouvé 1 602, il en
 * reste 241 dont personne ne peut dire s'ils marchent ». On ne peut plus passer à côté
 * d'un problème par ignorance : au pire il est dans la colonne « non prouvé ».
 *
 *   node inventaire.mjs <repo>                  → couverture par écran, puis le reste
 *   node inventaire.mjs <repo> --non-prouves    → seulement ce qui n'est pas prouvé
 *   node inventaire.mjs <repo> --json
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const FLAGS = process.argv.slice(2).filter((a) => a.startsWith('--'));
const AS_JSON = FLAGS.includes('--json');
const SEUL_NON_PROUVES = FLAGS.includes('--non-prouves');

const IGNORED = new Set(['node_modules', '_generated', '.next', '.git', 'dist', 'build', '.vercel', 'coverage', 'out']);
const LEGACY = /(^|\/)(_?legacy|archive|old|backup|deprecated)\//i;

function walk(dir, out = []) {
  let e;
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (IGNORED.has(x.name) || x.name.startsWith('.')) continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx|ts|js|mjs)$/.test(x.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT)
  .map((p) => ({ rel: path.relative(ROOT, p).split(path.sep).join('/'), txt: fs.readFileSync(p, 'utf8') }))
  .filter((f) => !LEGACY.test(f.rel) && !/\.(test|spec|stories)\./.test(f.rel));

const ui = files.filter((f) => /\.(tsx|jsx)$/.test(f.rel));
const lineAt = (txt, i) => txt.slice(0, i).split('\n').length;

/* ── Ce qui compte comme PREUVE ──────────────────────────────────────────────
   Un élément est prouvé quand on peut nommer ce à quoi il est relié. Pas quand
   il « a l'air correct » : quand la liaison est visible dans le code.          */

const LECTURE = /useQuery|usePaginatedQuery|useSuspenseQuery|useSWR|useFormState|fetch\(|getServerSideProps|getStaticProps|await\s+(prisma|db|supabase|sql)|useSession|useUser|useAuth|preloadQuery|loader\(|props\./;
const ECRITURE = /useMutation|useAction|\.mutate|mutation\(|fetch\(|axios|action\(|formAction|startTransition|router\.(push|replace|refresh|back)|signIn|signOut|revalidate|upload|window\.(open|location)|setSearchParams|onOpenChange|useRouter/;

// Le handler mène-t-il, DE PROCHE EN PROCHE, à une écriture ?
// Un bouton appelle `enregistrerNouvelle()`, qui appelle `creerTache()`, qui est un
// useMutation. S'arrêter au premier niveau déclarerait ce bouton mort. On calcule donc
// l'ensemble des fonctions « qui écrivent » par points fixes, jusqu'à stabilité.
const CACHE_ECRIVAINS = new Map();
function ecrivainsDe(txt) {
  if (CACHE_ECRIVAINS.has(txt)) return CACHE_ECRIVAINS.get(txt);
  const corps = new Map();
  // La regex ne capture PAS le corps : elle le consommerait et sauterait toutes les
  // déclarations situées dans sa fenêtre. On repère la déclaration, puis on découpe.
  for (const m of txt.matchAll(/(?:const|let|function)\s+(\w+)\s*=?\s*(?:async\s*)?(?=\(|function\b)/g)) {
    if (!corps.has(m[1])) corps.set(m[1], txt.slice(m.index, m.index + 900));
  }
  const ecrivains = new Set();
  for (const m of txt.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(useMutation|useAction|useUploadFile)\b/g)) ecrivains.add(m[1]);
  for (const [nom, c] of corps) if (ECRITURE.test(c)) ecrivains.add(nom);
  for (let passe = 0; passe < 4; passe++) {
    let ajout = false;
    for (const [nom, c] of corps) {
      if (ecrivains.has(nom)) continue;
      for (const appel of c.matchAll(/\b(\w+)\s*\(/g)) {
        if (ecrivains.has(appel[1])) { ecrivains.add(nom); ajout = true; break; }
      }
    }
    if (!ajout) break;
  }
  CACHE_ECRIVAINS.set(txt, ecrivains);
  return ecrivains;
}
function appelleUneEcriture(txt, corps) {
  const ecrivains = ecrivainsDe(txt);
  for (const m of String(corps).matchAll(/\b(\w+)\s*\(/g)) if (ecrivains.has(m[1])) return true;
  return false;
}

const elements = [];
const ajouter = (e) => elements.push(e);

/* ── 1. Les écrans ──────────────────────────────────────────────────────── */

const ecrans = ui.filter((f) => /(^|\/)(page|screen|view)\.(tsx|jsx)$/.test(f.rel) || /\/(pages|screens|views)\//.test(f.rel));
for (const f of ecrans) {
  const lit = LECTURE.test(f.txt);
  const elementsDeDonnee = (f.txt.match(/<(Input|Select|Textarea|Field|Table|Td|Tr|option|Card)\b/g) || []).length;
  const composants = /<[A-Z]\w+/.test(f.txt);
  ajouter({
    type: 'écran', nom: f.rel, fichier: f.rel, ligne: 1,
    prouve: lit ? true : elementsDeDonnee === 0 ? null : false,
    preuve: lit ? 'lit une source' : null,
    pourquoi: lit ? null
      : elementsDeDonnee === 0 ? 'aucune donnée affichée directement : délègue à des composants, à vérifier'
      : `${elementsDeDonnee} éléments de données affichés sans aucune lecture de source`,
  });
}

/* ── 2. Les éléments interactifs : tout ce qui se clique ────────────────── */

function attributs(txt, i) {
  let prof = 0;
  for (let k = i; k < Math.min(txt.length, i + 1500); k++) {
    const c = txt[k];
    if (c === '{') prof++;
    else if (c === '}') prof--;
    else if (c === '>' && prof === 0 && txt[k - 1] !== '=') return txt.slice(i, k);
  }
  return txt.slice(i, i + 1500);
}

// Le corps d'un gestionnaire, pour savoir ce qu'il fait vraiment.
function corpsDuHandler(txt, attrs, nomFichier) {
  const m = attrs.match(/\b(onClick|onSubmit|onPress|onValueChange|onChange)\s*=\s*\{([\s\S]{0,400})/);
  if (!m) return null;
  const val = m[2];
  // Handler en ligne : on lit son corps. Handler nommé : on va chercher sa définition.
  if (/^\s*(\(|async)/.test(val)) return val;
  const nom = (val.match(/^\s*(\w+)/) || [])[1];
  if (!nom) return val;
  const def = txt.match(new RegExp(`(?:const|function)\\s+${nom}\\s*=?[\\s\\S]{0,600}`));
  if (def) return def[0];
  // Pas de définition ici : le handler vient du parent. On ne peut pas conclure
  // depuis ce fichier, et prétendre le contraire fabriquerait un faux positif.
  return '\u0000PROP';
}

const BALISES_CLIQUABLES = /<(button|a|Button|Link|IconButton|MenuItem|Tab|Card|Row)\b/g;
for (const f of ui) {
  let m;
  BALISES_CLIQUABLES.lastIndex = 0;
  while ((m = BALISES_CLIQUABLES.exec(f.txt))) {
    const attrs = attributs(f.txt, m.index + m[0].length);
    const balise = m[1];
    const ligne = lineAt(f.txt, m.index);

    // Un lien : sa preuve est sa destination.
    if (/^(a|Link)$/i.test(balise)) {
      const href = (attrs.match(/\bhref\s*=\s*(?:["'`]([^"'`]*)["'`]|\{([^}]*)\})/) || []);
      const cible = href[1] ?? href[2];
      const valide = cible !== undefined && cible !== '' && cible !== '#';
      ajouter({
        type: 'lien', nom: `<${balise}> ${cible ?? '(sans href)'}`, fichier: f.rel, ligne,
        prouve: valide, preuve: valide ? `mène à ${cible}` : null,
        pourquoi: cible === '#' || cible === '' ? 'href vide ou "#"' : 'aucune destination',
      });
      continue;
    }

    const aHandler = /on(Click|Submit|Press|ValueChange)\s*=/.test(attrs);
    const estSoumission = /type\s*=\s*["'`]submit|form\s*=/.test(attrs);
    const propage = /\{\.\.\./.test(attrs) || /\bdisabled\b/.test(attrs);
    if (!aHandler && !estSoumission && !propage) {
      ajouter({ type: 'bouton', nom: `<${balise}> ${etiquette(f.txt, m.index)}`, fichier: f.rel, ligne,
        prouve: false, preuve: null, pourquoi: 'aucun gestionnaire, aucun type=submit' });
      continue;
    }
    if (propage && !aHandler) {
      ajouter({ type: 'bouton', nom: `<${balise}> ${etiquette(f.txt, m.index)}`, fichier: f.rel, ligne,
        prouve: null, preuve: null, pourquoi: 'gestionnaire reçu par props : à vérifier chez l\'appelant' });
      continue;
    }

    const corps = corpsDuHandler(f.txt, attrs, f.rel) || '';
    // Un handler appelle souvent une fonction locale (`void archiver({id})`). Il faut
    // remonter à sa définition pour savoir si elle écrit, sinon on déclare mort un
    // bouton parfaitement câblé — et un détecteur qui se trompe ne sert à rien.
    const viaProps = corps === '\u0000PROP';
    const agit = !viaProps && (ECRITURE.test(corps) || appelleUneEcriture(f.txt, corps));
    const purementLocal = !viaProps && /\bset[A-Z]\w*\s*\(/.test(corps) && !agit;
    ajouter({
      type: 'bouton', nom: `<${balise}> ${etiquette(f.txt, m.index)}`, fichier: f.rel, ligne,
      prouve: agit ? true : (viaProps || purementLocal) ? null : false,
      preuve: agit ? 'déclenche une écriture ou une navigation' : null,
      pourquoi: agit ? null
        : viaProps ? 'gestionnaire reçu du parent : à vérifier chez l\'appelant'
        : purementLocal ? 'état local seulement : légitime pour un onglet, suspect pour une action'
        : 'le gestionnaire ne mène à aucune écriture ni navigation',
    });
  }
}

// Le libellé VISIBLE du bouton : le texte entre la balise ouvrante et la fermante,
// pas le premier identifiant du code (qui donnerait « void archiver »).
function etiquette(txt, i) {
  const debutAttrs = txt.indexOf(' ', i);
  const fin = i + (attributs(txt, i).length) + (txt.slice(i).indexOf('<') === 0 ? 0 : 0);
  if (fin <= i) return '';
  const contenu = txt.slice(fin + 1, fin + 300);
  const stop = contenu.search(/<\/(button|a|Button|Link)/);
  const visible = (stop === -1 ? contenu : contenu.slice(0, stop))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mot = visible.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9' -]{1,28}/);
  return mot ? `« ${mot[0].trim()} »` : '';
}

/* ── 3. Les champs de saisie ────────────────────────────────────────────── */

const nomDuChamp = (attrs) => (attrs.match(/\bname\s*=\s*["'`]([^"'`]+)["'`]/) || attrs.match(/\bplaceholder\s*=\s*["'`]([^"'`]+)["'`]/) || [])[1];

const CHAMPS = /<(input|Input|textarea|Textarea|select|Select|Checkbox|Switch|DatePicker)\b/g;
for (const f of ui) {
  let m;
  CHAMPS.lastIndex = 0;
  while ((m = CHAMPS.exec(f.txt))) {
    const attrs = attributs(f.txt, m.index + m[0].length);
    const ligne = lineAt(f.txt, m.index);
    const val = attrs.match(/\b(value|defaultValue|checked|defaultChecked)\s*=\s*(?:\{([^}]{0,120})\}|["'`]([^"'`]{0,80})["'`])/);
    const litteral = val?.[3];
    const expression = val?.[2];
    let prouve = null, preuve = null, pourquoi = 'aucune valeur : champ vierge, à confirmer volontaire';
    if (litteral !== undefined && litteral !== '') {
      prouve = false; pourquoi = `valeur écrite en dur : "${litteral}"`;
    } else if (expression) {
      const source = origine(f.txt, expression);
      prouve = source.prouve; preuve = source.preuve; pourquoi = source.pourquoi;
    }
    ajouter({ type: 'champ', nom: `<${m[1]}> ${nomDuChamp(attrs) || ''}`.trim(), fichier: f.rel, ligne, prouve, preuve, pourquoi });
  }
}

// D'où vient une expression affichée ? On remonte à sa déclaration dans le fichier.
function origine(txt, expr) {
  const racine = (String(expr).match(/([\w$]+)/) || [])[1];
  if (!racine) return { prouve: null, preuve: null, pourquoi: 'expression non analysable' };
  const decl = txt.match(new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\b${racine}\\b[^}]*\\}|${racine})\\s*=\\s*([\\s\\S]{0,200})`));
  if (!decl) {
    if (/^(props|params|searchParams)$/.test(racine)) return { prouve: null, preuve: 'vient des props', pourquoi: 'à vérifier chez le parent' };
    return { prouve: null, preuve: null, pourquoi: `« ${racine} » déclaré ailleurs : origine non tracée` };
  }
  const source = decl[1];
  if (LECTURE.test(source)) return { prouve: true, preuve: `vient de ${(source.match(/use\w+|fetch|prisma|supabase/) || ['une lecture'])[0]}`, pourquoi: null };
  if (/^\s*["'`\d[]/.test(source)) return { prouve: false, preuve: null, pourquoi: `« ${racine} » est une constante écrite dans le fichier` };
  return { prouve: null, preuve: null, pourquoi: `« ${racine} » vient d'un calcul local : origine à confirmer` };
}

/* ── 4. Les valeurs affichées (dont les chiffres) ───────────────────────── */

for (const f of ui) {
  // Contenu texte d'une balise : un littéral qui ressemble à une donnée.
  for (const m of f.txt.matchAll(/>\s*([^<>{}\n]{1,60}?)\s*</g)) {
    const v = m[1].trim();
    if (!v || v.length < 2) continue;
    const estDonnee = /^\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d+)?\s*(%|€|\$|CHF|k|M)?$/.test(v)
      || /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(v)
      || /^\+?\d[\d\s().-]{8,}$/.test(v);
    if (!estDonnee) continue;                       // un libellé d'interface n'est pas une donnée
    if (/^[01]$/.test(v)) continue;
    ajouter({ type: 'valeur', nom: `« ${v} »`, fichier: f.rel, ligne: lineAt(f.txt, m.index),
      prouve: false, preuve: null, pourquoi: 'donnée affichée écrite en dur' });
  }
}

/* ── 5. Le backend : fonctions et tables ────────────────────────────────── */

const backend = files.filter((f) => /^convex\//.test(f.rel) || /\/(server|api)\//.test(f.rel) || /route\.(ts|js)$/.test(f.rel));
for (const f of backend) {
  for (const m of f.txt.matchAll(/export const (\w+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*\(/g)) {
    const mod = f.rel.replace(/^convex\//, '').replace(/\.ts$/, '');
    const appelee = files.some((g) => g.rel !== f.rel && new RegExp(`\\.\\s*${m[1]}\\b`).test(g.txt));
    ajouter({ type: 'fonction', nom: `${mod}.${m[1]}`, fichier: f.rel, ligne: lineAt(f.txt, m.index),
      prouve: appelee, preuve: appelee ? 'appelée ailleurs' : null,
      pourquoi: appelee ? null : 'aucun appel trouvé dans le repo' });
  }
  for (const m of f.txt.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    const chemin = '/' + f.rel.replace(/^(src\/)?app\//, '').replace(/\/route\.(ts|js)$/, '').replace(/\/\([^)]+\)/g, '');
    const appelee = files.some((g) => g.rel !== f.rel && g.txt.includes(chemin));
    ajouter({ type: 'route', nom: `${m[1]} ${chemin}`, fichier: f.rel, ligne: lineAt(f.txt, m.index),
      prouve: appelee, preuve: appelee ? 'appelée depuis le repo' : null,
      pourquoi: appelee ? null : 'aucun appel dans le repo : externe (à annoter) ou morte' });
  }
}

const schema = files.find((f) => /convex\/schema\.ts$/.test(f.rel));
if (schema) {
  for (const m of schema.txt.matchAll(/^\s{2}([a-zA-Z_]\w*)\s*:\s*defineTable/gm)) {
    const t = m[1];
    const lue = files.some((f) => new RegExp(`\\.query\\(\\s*["'\`]${t}["'\`]`).test(f.txt));
    const ecrite = files.some((f) => new RegExp(`\\.(insert|replace)\\(\\s*["'\`]${t}["'\`]`).test(f.txt));
    ajouter({ type: 'table', nom: t, fichier: schema.rel, ligne: lineAt(schema.txt, m.index),
      prouve: lue && ecrite, preuve: lue && ecrite ? 'lue et écrite' : null,
      pourquoi: lue && ecrite ? null : !lue && !ecrite ? 'ni lue ni écrite' : !lue ? 'écrite mais jamais lue' : 'lue mais jamais écrite' });
  }
}

/* ── Rapport ────────────────────────────────────────────────────────────── */

const TYPES = ['écran', 'bouton', 'lien', 'champ', 'valeur', 'fonction', 'route', 'table'];
const stat = (liste) => ({
  total: liste.length,
  prouves: liste.filter((e) => e.prouve === true).length,
  casses: liste.filter((e) => e.prouve === false).length,
  incertains: liste.filter((e) => e.prouve === null).length,
});

const global = stat(elements);

if (AS_JSON) {
  process.stdout.write(JSON.stringify({ root: ROOT, global, elements }, null, 2) + '\n');
  process.exitCode = global.casses ? 1 : 0;
} else {
  console.log(`\n╔══ INVENTAIRE ─ ${path.basename(ROOT)}`);
  console.log(`║  ${global.total} éléments recensés dans le produit`);
  console.log(`║  ${global.prouves} prouvés · ${global.casses} non reliés · ${global.incertains} non prouvés`);
  console.log(`╚══ couverture : ${Math.round((global.prouves / Math.max(1, global.total)) * 100)} %\n`);

  console.log('Par nature :\n');
  for (const t of TYPES) {
    const s = stat(elements.filter((e) => e.type === t));
    if (!s.total) continue;
    const pct = Math.round((s.prouves / s.total) * 100);
    const barre = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');
    console.log(`  ${t.padEnd(9)} ${barre} ${String(pct).padStart(3)} %   ${s.total} au total · ${s.casses} non reliés · ${s.incertains} à vérifier`);
  }

  const casses = elements.filter((e) => e.prouve === false);
  const incertains = elements.filter((e) => e.prouve === null);

  console.log(`\n\n━━━ NON RELIÉS (${casses.length}) ─ prouvé que ça ne marche pas ━━━\n`);
  for (const e of casses.slice(0, SEUL_NON_PROUVES ? 1e9 : 25)) {
    console.log(`  ${e.type.padEnd(9)} ${e.nom.slice(0, 46).padEnd(48)} ${e.fichier}:${e.ligne}`);
    console.log(`  ${''.padEnd(9)} → ${e.pourquoi}`);
  }
  if (!SEUL_NON_PROUVES && casses.length > 25) console.log(`  … ${casses.length - 25} autres (--non-prouves pour tout voir)`);

  console.log(`\n\n━━━ NON PROUVÉS (${incertains.length}) ─ personne ne peut dire si ça marche ━━━\n`);
  const parRaison = new Map();
  for (const e of incertains) {
    const clef = e.pourquoi.replace(/« [^»]+ »/, '« … »');
    parRaison.set(clef, (parRaison.get(clef) || 0) + 1);
  }
  for (const [raison, n] of [...parRaison.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} × ${raison}`);
  }
  console.log(`\n  Ceux-là ne sont pas des bugs : ce sont les angles morts de l'analyse statique.`);
  console.log(`  Ils se tranchent en passant dans l'application (preuve par témoin, parcours réel).\n`);

  process.exitCode = casses.length ? 1 : 0;
}

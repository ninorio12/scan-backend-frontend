/**
 * gardes.mjs — Qui garde vraiment, et qui prétend garder.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * La règle B1 reconnaissait une garde à son NOM, dans une liste écrite en anglais
 * (requireUser, ensureUser, checkAccess…). Mesuré sur un banc neutre : un projet dont
 * le helper de garde s'appelait `orgCourante` a produit 16 faux positifs sur 16, et la
 * seule fonction qui avait un vrai trou s'est retrouvée noyée dans le lot avec un motif
 * faux. Notre code est écrit en français : le problème est chez nous, dans tous nos
 * projets. Et la règle était prenable dans l'autre sens : le mot « token » dans un
 * commentaire suffisait à faire passer une porte nue (point 28 de LA LISTE).
 *
 * CE QU'ON FAIT À LA PLACE
 *
 * On ne cherche plus une chaîne de caractères, on résout un symbole :
 *
 *   1. On repère les PRIMITIVES : les endroits du dépôt qui vérifient réellement
 *      quelque chose (l'identité de session, une signature, un secret partagé).
 *   2. On PROPAGE par point fixe : une fonction qui appelle une garde est une garde.
 *      Le nom n'intervient jamais, seulement l'appel.
 *   3. Une porte publique est gardée si son corps atteint une primitive, directement
 *      ou à travers n'importe quelle chaîne d'appels locale.
 *
 * Les commentaires et les chaînes de caractères sont neutralisés avant analyse, sinon
 * un commentaire qui décrit la garde vaut la garde.
 */

/* ── Neutraliser commentaires et littéraux, en gardant les longueurs ────────
   On remplace par des espaces plutôt que de supprimer : les décalages restent
   valides, donc un index calculé sur le texte nettoyé pointe le même endroit
   dans le texte d'origine. */
export function sansBruit(src) {
  const out = src.split('');
  let i = 0;
  const blanc = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j === -1) j = src.length; blanc(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j === -1 ? src.length : j + 2; blanc(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      // On blanchit segment par segment : tout ce qui est littéral disparaît, et les
      // `${…}` d'un gabarit sont sautés intacts, parce qu'ils contiennent du vrai code.
      // Les effacer faisait disparaître `jeton !== `Bearer ${process.env.CRON_SECRET}``,
      // c'est-à-dire la forme la plus courante de vérification d'un secret partagé.
      let j = i + 1, segment = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          blanc(segment, j);
          let prof = 1, k = j + 2;
          while (k < src.length && prof > 0) { if (src[k] === '{') prof++; else if (src[k] === '}') prof--; k++; }
          j = k; segment = k; continue;
        }
        j++;
      }
      blanc(segment, j);
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/* ── Les primitives : ce qui vérifie réellement quelque chose ───────────────
   Trois familles, parce qu'une porte se garde de trois façons légitimes et que
   n'en connaître qu'une fabrique des faux positifs sur les deux autres. */
const PRIMITIVES = [
  // 1. Une identité de session, quel que soit le fournisseur.
  /\bctx\s*\.\s*auth\b/,
  /\bgetAuthUserId\s*\(/,
  /\bgetUserIdentity\s*\(/,
  /\bauth\s*\(\s*\)|\bcurrentUser\s*\(\s*\)|\bgetServerSession\s*\(/,
  /\bclerkClient\b|\bverifyToken\s*\(|\bverifySessionCookie\s*\(/,
  // Supabase : l'identité se lit sur le client, pas sur un ctx. Sans cette ligne, TOUTE
  // route d'un projet Supabase est déclarée sans garde et le seul vrai trou se retrouve
  // noyé au milieu. Mesuré sur banc/stacks/next-supabase : 5 faux positifs sur 6.
  /\.\s*auth\s*\.\s*(getUser|getSession|getClaims)\s*\(/,
  /\bcreateServerClient\s*\([\s\S]{0,400}?\.\s*auth\b/,
  // 2. Une signature cryptographique (le cas des webhooks : ils ne s'authentifient
  //    pas par identité, et les traiter comme des portes nues est un faux positif).
  /\bcreateHmac\s*\(|\btimingSafeEqual\s*\(|\bconstructEvent\s*\(/,
  /\bverif\w*\s*\(\s*\w*(?:signature|sign|hmac|digest)/i,
  // 3. Un secret partagé comparé à ce que l'appelant présente.
  // Les deux sens, et sans exiger l'adjacence : `jeton !== `Bearer ${process.env.CRON_SECRET}``
  // est la forme la plus courante et le gabarit s'intercale entre les deux. On borne au
  // point-virgule et à la fin de ligne pour ne pas attraper deux instructions voisines.
  /process\s*\.\s*env\s*\.\s*\w*(?:SECRET|TOKEN|KEY|SIGNING|PASS)\w*[^;\n]{0,60}?(?:===|!==|==|!=)/,
  /(?:===|!==|==|!=)[^;\n]{0,60}?process\s*\.\s*env\s*\.\s*\w*(?:SECRET|TOKEN|KEY|SIGNING|PASS)\w*/,
  /\bhub\.verify_token\b|\bverify_token\b/,
];

const estPrimitive = (corps) => PRIMITIVES.some((re) => re.test(corps));

/* ── Repérer les fonctions déclarées d'un fichier, avec leur corps ──────────
   Parseur volontairement simple : on veut le nom et l'étendue, pas un AST complet.
   Les trois formes qui couvrent tout notre code : `function nom(`, `const nom =`
   (flèche ou fonction), et les méthodes d'objet ne nous intéressent pas ici. */
const DECLARATION = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function)/g;

/* Le corps s'arrête à l'accolade fermante correspondante, PAS à la déclaration
   suivante. C'est exactement le défaut de fenêtrage qu'on reproche aux autres règles :
   avec une fenêtre, une fonction de trois lignes hérite de la garde de sa voisine, et
   `norm`, `iso`, `clean` se retrouvent classés « vérifie l'identité ». Mesuré. */
function corpsDe(texte, debut) {
  const ouvre = texte.indexOf('{', debut);
  const flecheCourte = texte.slice(debut, ouvre === -1 ? texte.length : ouvre);
  // `const f = (x) => x * 2;` n'a pas d'accolade : le corps tient sur l'expression.
  if (ouvre === -1 || /=>\s*[^{\s]/.test(flecheCourte)) {
    const fin = texte.indexOf('\n', debut);
    return texte.slice(debut, fin === -1 ? texte.length : fin);
  }
  let prof = 0;
  for (let i = ouvre; i < texte.length; i++) {
    if (texte[i] === '{') prof++;
    else if (texte[i] === '}') { prof--; if (prof === 0) return texte.slice(debut, i + 1); }
  }
  return texte.slice(debut);
}

function declarations(texte) {
  const out = [];
  DECLARATION.lastIndex = 0;
  let m;
  while ((m = DECLARATION.exec(texte))) {
    const nom = m[1] || m[2] || m[3];
    if (!nom) continue;
    out.push({ nom, corps: corpsDe(texte, m.index) });
  }
  return out;
}

/* ── L'ensemble des gardes du dépôt, par point fixe ─────────────────────────
   `fichiers` : [{ rel, txt }]. Retourne un Set de noms de fonctions qui gardent,
   plus le détail de ce qui les rend gardes (pour pouvoir l'expliquer dans un rapport). */
export function resoudreGardes(fichiers) {
  const toutes = new Map();   // nom -> corps nettoyé (concaténé si homonymes)
  for (const f of fichiers) {
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(f.rel)) continue;
    const propre = sansBruit(f.txt);
    for (const d of declarations(propre)) {
      toutes.set(d.nom, (toutes.get(d.nom) || '') + '\n' + d.corps);
    }
  }

  /* Les handlers de route (GET, POST...) peuvent etre gardes, mais ils ne transmettent
     rien : ce sont des points d'entree, pas des helpers qu'on appelle. Les laisser dans
     la propagation contamine par homonymie (une fonction `post()` quelconque herite de
     la garde du handler `POST`, puis tout ce qui l'appelle). Mesure sur projet client B. */
  const POINTS_ENTREE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|handler|default)$/;

  const gardes = new Set();
  const pourquoi = new Map();
  for (const [nom, corps] of toutes) {
    if (estPrimitive(corps)) { gardes.add(nom); pourquoi.set(nom, 'vérifie directement'); }
  }

  /* Les noms appelés par chaque fonction, extraits UNE fois. La version naïve
     construisait une expression régulière par couple (garde, fonction) : sur projet client C
     et ses 906 portes, la mesure dépassait deux minutes. Or la cible est un auditeur
     assez rapide pour tourner à chaque écriture de fichier, donc le coût est une
     contrainte de conception, pas un détail. Ici : une passe, puis des intersections
     d'ensembles. */
  const APPEL = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  const appelsDe = new Map();
  for (const [nom, corps] of toutes) {
    const vus = new Set();
    APPEL.lastIndex = 0;
    let m;
    while ((m = APPEL.exec(corps))) vus.add(m[1]);
    appelsDe.set(nom, vus);
  }

  // Point fixe : appeler une garde, c'est garder. Une passe ne propage qu'un niveau,
  // on itère jusqu'à stabilité.
  let bouge = true, tours = 0;
  while (bouge && tours++ < 20) {
    bouge = false;
    for (const [nom] of toutes) {
      if (gardes.has(nom)) continue;
      for (const appele of appelsDe.get(nom)) {
        if (appele === nom || POINTS_ENTREE.test(appele) || !gardes.has(appele)) continue;
        gardes.add(nom); pourquoi.set(nom, `appelle ${appele}`); bouge = true; break;
      }
    }
  }

  return { gardes, pourquoi, estPrimitive, appelsDe };
}

/* ── La question que pose B1 ────────────────────────────────────────────────
   Le corps d'une unité est-il gardé ? Soit il vérifie lui-même, soit il appelle
   quelque chose qui vérifie. Le nom de ce quelque chose n'a aucune importance. */
export function estGardee(corpsBrut, gardes) {
  const corps = sansBruit(corpsBrut);
  if (estPrimitive(corps)) return 'vérifie directement';
  const APPEL = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = APPEL.exec(corps))) {
    if (gardes.has(m[1])) return `appelle ${m[1]}`;
  }
  return null;
}

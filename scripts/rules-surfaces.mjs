/**
 * AXE D — SURFACES FANTÔMES.
 *
 * L'autre moitié du câblage cassé. L'axe A trouve le code qui n'a pas de surface ;
 * celui-ci trouve la surface qui n'a pas de source : un écran qui affiche des valeurs
 * écrites en dur, un bouton qui annonce « Enregistré » sans rien écrire, une page
 * entière restée à l'état de maquette.
 *
 * C'est le défaut le plus coûteux de tous, parce qu'il est invisible à la relecture :
 * l'écran a l'air parfait, il est même plus joli qu'un écran réel puisque ses données
 * sont choisies. Seul un passage dans l'application, ou ce détecteur, le révèle.
 *
 * Générique React / JSX : ne dépend d'aucune base de données.
 */

// Un littéral qui ressemble à une donnée de personne ou de métier, pas à un réglage.
const DONNEE = [
  [/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i, 'email'],
  [/^\+?[\d][\d\s().-]{7,}$/, 'téléphone'],
  [/^\d{1,3}([ .,]\d{3})*([.,]\d{2})?\s*(€|\$|CHF|EUR|USD)$/i, 'montant'],
  [/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/, 'date'],
  [/^[A-ZÀ-Ÿ][a-zà-ÿ]+(\s[A-ZÀ-Ÿ][a-zà-ÿ'-]+)*$/u, 'nom propre ou libellé'],
];

// Un handler qui ne fait qu'annoncer un succès.
// Annoncer un succès prend mille formes : un toast, un bandeau, un état local qui
// porte le message. Trouvé sur le banc d'essai : setRetour({ texte: "Invitation
// enregistrée" }) ment exactement comme un toast, et n'était pas reconnu.
const ANNONCE = /toast|alert|notify|message\.\w+|console\.log|set(Saved|Success|Retour|Message|Statut|Status|Feedback|Confirmation|Etat|Notice|Info)\b/i;
const MOT_SUCCES = /enregistr|sauvegard|envoy|cré[ée]|supprim|ajout|mis à jour|modifi|saved|sent|created|updated|deleted|success|succès/i;
// Un vrai effet : appel serveur, navigation, écriture.
const VRAI_EFFET = /useMutation|mutation|fetch\(|axios|action\(|submit|router\.(push|replace|refresh)|revalidate|signIn|signOut|upload|\.mutate|startTransition|useFormState|formAction/i;
// Une vraie lecture de source.
const LECTURE = /useQuery|usePaginatedQuery|useSuspenseQuery|useSWR|fetch\(|getServerSideProps|getStaticProps|await\s+prisma|await\s+db|await\s+supabase|useSession|useUser|useAuth|preloadQuery|loader\(/;

// Retourne les attributs d'une balise ouvrante, en sautant les « > » qui appartiennent
// à une fonction fléchée (=>) ou à une comparaison à l'intérieur d'une accolade.
function finDeBalise(txt, i) {
  let prof = 0;
  for (let k = i; k < Math.min(txt.length, i + 1200); k++) {
    const c = txt[k];
    if (c === '{') prof++;
    else if (c === '}') prof--;
    else if (c === '>' && prof === 0 && txt[k - 1] !== '=') return txt.slice(i, k);
  }
  return txt.slice(i, i + 1200);
}

const estFichierUI = (rel) => /\.(tsx|jsx)$/.test(rel) && !/\.(test|spec|stories)\./.test(rel);
const estEcran = (rel) => /(^|\/)(page|layout|screen|view)\.(tsx|jsx)$/.test(rel) || /\/(pages|screens|views)\//.test(rel);

// Le code lu comme du texte confond un bouton avec le mot « bouton » écrit dans un
// commentaire. On neutralise commentaires et chaînes en gardant EXACTEMENT la longueur,
// pour que les numéros de ligne et les positions restent justes.
function sansCommentaires(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '));
}

export default function reglesSurfaces({ files, lineAt }) {
  const out = [];
  const ui = files.filter((f) => estFichierUI(f.rel)).map((f) => ({ ...f, txt: sansCommentaires(f.txt) }));

  /* D1 · Champ de saisie pré-rempli d'une valeur écrite en dur. */
  {
    const durs = [], tièdes = [];
    for (const f of ui) {
      for (const m of f.txt.matchAll(/\b(defaultValue|defaultChecked|value)\s*=\s*["'`]([^"'`\n]{1,60})["'`]/g)) {
        const val = m[2].trim();
        if (!val) continue;
        const typé = DONNEE.find(([re]) => re.test(val));
        const item = `${f.rel}:${lineAt(f.txt, m.index)}  ${m[1]}="${val}"`;
        if (typé) durs.push(`${item}   ← ${typé[1]}`);
        else tièdes.push(item);
      }
    }
    out.push(['D1', 'D', 'BLOQUANT', `Champs pré-remplis d'une donnée écrite en dur (${durs.length})`, durs,
      "Un champ de formulaire pré-rempli doit toujours venir de la source. Une valeur en dur est une donnée de maquette restée en production : l'écran affiche une identité qui n'existe pas, et personne ne s'en aperçoit parce qu'elle est plausible.\nQuand la donnée n'est pas encore chargée, on affiche un squelette, jamais une valeur."]);
    out.push(['D1b', 'D', 'À TRAITER', `Autres valeurs de champ en dur (${tièdes.length})`, tièdes,
      "Souvent légitime (unité, devise, langue par défaut). À vérifier une fois : ce qui relève d'un réglage reste, ce qui relève d'une donnée se câble."]);
  }

  /* D2 · Action qui ment : annonce un succès sans rien faire. */
  {
    const menteurs = [];
    for (const f of ui) {
      for (const m of f.txt.matchAll(/\b(onClick|onSubmit|onPress|onConfirm)\s*=\s*\{?\s*(?:\(\s*\)|\([^)]*\))\s*=>\s*([\s\S]{0,220}?)(?:\}\s*\n|\/>|\}\s*>)/g)) {
        const corps = m[2];
        if (!ANNONCE.test(corps)) continue;
        if (VRAI_EFFET.test(corps)) continue;
        if (!MOT_SUCCES.test(corps)) continue;
        // Reste-t-il un appel de fonction une fois retirés l'annonce et les setters
        // d'état local ? Si oui, le handler fait quelque chose : ce n'est pas un mensonge.
        const residu = corps
          .replace(/\b(toast|alert|notify|console\.\w+|message\.\w+)\s*\([^)]*\)/g, '')
          .replace(/\bset[A-Z]\w*\s*\([^)]*\)/g, '')
          .replace(/["'`][^"'`]*["'`]/g, '');
        if (/\b\w+\s*\(/.test(residu)) continue;
        menteurs.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${m[1]} → ${corps.replace(/\s+/g, ' ').slice(0, 70)}`);
      }
    }
    out.push(['D2', 'D', 'BLOQUANT', `Actions qui annoncent un succès sans rien écrire (${menteurs.length})`, menteurs,
      "Le bouton dit « Enregistré », rien n'est parti. C'est le pire défaut du lot : l'utilisateur a la preuve visuelle que ça a marché, donc il ne signalera jamais le bug, et la donnée est perdue en silence.\nUne action doit appeler une mutation ; le message de succès n'arrive qu'après sa résolution."]);
  }

  /* D3 · Écran de données qui ne lit aucune source. */
  {
    const fantomes = [];
    for (const f of ui) {
      if (!estEcran(f.rel)) continue;
      if (LECTURE.test(f.txt)) continue;
      // L'écran manipule-t-il des données (champs, tableaux, listes) ?
      const champs = (f.txt.match(/<(Input|Select|Textarea|Field|TableRow|Td|Tr|option)\b/g) || []).length;
      const lignes = f.txt.split('\n').length;
      if (champs < 3 || lignes < 40) continue;
      // Reçoit-il ses données par props d'un parent qui, lui, lit ?
      if (/\bprops\b|\(\s*\{\s*\w+.*\}\s*:\s*\{/.test(f.txt.slice(0, 600))) continue;
      fantomes.push(`${f.rel}  (${champs} champs, aucune lecture de source)`);
    }
    out.push(['D3', 'D', 'BLOQUANT', `Écrans de données sans aucune lecture de source (${fantomes.length})`, fantomes,
      "Une page entière restée à l'état de maquette : elle a l'air finie, elle est même plus belle qu'un écran réel puisque ses données sont choisies. Tant que personne ne la traverse avec un vrai compte, elle passe toutes les relectures."]);
  }

  /* D4 · Jeu de données de démonstration en dur dans un composant. */
  {
    const demos = [];
    for (const f of ui) {
      for (const m of f.txt.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]{0,60})?=\s*\[\s*\{([\s\S]{0,600}?)\}\s*,\s*\{/g)) {
        const bloc = m[2];
        const indices = DONNEE.filter(([re]) => [...bloc.matchAll(/["'`]([^"'`\n]{2,40})["'`]/g)].some((x) => re.test(x[1].trim()))).length;
        if (indices < 2) continue;
        if (/^(TABS|TABLE|COLS|COLUMNS|MENU|NAV|LINKS|OPTIONS|STEPS|ITEMS_NAV|ROUTES|MODULES)$/i.test(m[1])) continue;
        demos.push(`${f.rel}:${lineAt(f.txt, m.index)}  const ${m[1]} = [ … ]`);
      }
    }
    out.push(['D4', 'D', 'À TRAITER', `Jeux de données de démonstration en dur (${demos.length})`, demos,
      "Une liste d'objets écrite dans le composant. Parfois c'est un référentiel légitime (menu, colonnes) : l'annoter. Sinon c'est une maquette qui survivra jusqu'à ce qu'un client la lise."]);
  }

  /* D5 · Identité écrite en dur dans la LOGIQUE, pas seulement affichée.
     Le cas le plus vicieux : une règle métier accrochée à un nom propre. Le jour où la
     personne change de nom, part, ou qu'une deuxième arrive, le produit se trompe sans
     rien signaler. Vaut pour tout le code, pas seulement les écrans. */
  {
    const enDur = [];
    const CONTACT = /^(?:[\w.+-]+@[\w-]+\.[a-z]{2,}|\+?\d[\d\s().-]{8,}\d)$/;
    const NOM_PROPRE = /^[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:\s+[A-ZÀ-Ÿ][\wà-ÿ'-]+)+$/u;
    // Clés qui désignent une personne. « Erreur Claude » et « Paiement échoué » ont la
    // forme d'un nom propre ; seule leur présence derrière une de ces clés prouve
    // qu'il s'agit vraiment de l'identité de quelqu'un.
    const CLE_IDENTITE = /(nom|name|prenom|firstName|lastName|assigne|assignee|auteur|author|owner|utilisateur|user|membre|courtier|agent|responsable|contact|createdBy|proprietaire)\s*[:=]\s*["'`]/i;
    const corpus = files.map((f) => f.txt).join('\n');
    // Même littéral, même verdict : la recherche dans le corpus est mémorisée (13 s
    // gagnées sur un dépôt où « Enregistrer » apparaît quatre cents fois).
    const memo = new Map();
    const estIdentite = (val) => {
      if (memo.has(val)) return memo.get(val);
      let r;
      if (/^[\d\s./-]+$/.test(val)) r = false; // une date ou un nombre n'est pas une identité
      else if (CONTACT.test(val)) r = true;
      else if (!NOM_PROPRE.test(val)) r = false;
      else r = new RegExp(CLE_IDENTITE.source + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(corpus);
      memo.set(val, r);
      return r;
    };
    const IDENTITE = { test: estIdentite };
    for (const f of files) {
      if (/\.(test|spec|stories)\.|\/(seed|fixtures?|mocks?)\//i.test(f.rel)) continue;
      const sondes = [
        [/[!=]==?\s*["'`]([^"'`\n]{3,60})["'`]/g, 'comparaison'],
        [/\?\?\s*["'`]([^"'`\n]{3,60})["'`]/g, 'valeur de repli'],
        [/\|\|\s*["'`]([^"'`\n]{3,60})["'`]/g, 'valeur de repli'],
        [/\bcase\s+["'`]([^"'`\n]{3,60})["'`]/g, 'branchement'],
        [/\.includes\(\s*["'`]([^"'`\n]{3,60})["'`]\s*\)/g, 'test d\'appartenance'],
      ];
      for (const [re, quoi] of sondes) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(f.txt))) {
          const val = m[1].trim();
          if (!IDENTITE.test(val)) continue;
          enDur.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${quoi} avec « ${val} »`);
        }
      }
    }
    out.push(['D5', 'D', 'BLOQUANT', `Identité écrite en dur dans la logique (${enDur.length})`, enDur,
      "Une règle métier accrochée à un nom propre, un email ou un numéro. Ce n'est plus un défaut d'affichage : le produit prend des décisions à partir d'une chaîne de caractères. Le jour où la personne change de nom, s'en va, ou qu'une deuxième arrive, la règle se trompe en silence.\nLa décision doit porter sur un identifiant stable ou un rôle lu en base, jamais sur un nom."]);
  }

  /* D6 · Bouton mort : il est là, il a l'air cliquable, il ne fait rien. */
  {
    const morts = [];
    for (const f of ui) {
      // <button …> sans gestionnaire, sans type=submit, sans lien.
      // Attention : le « > » d'une fonction fléchée (=>) n'est pas la fin de la balise.
      for (const m of f.txt.matchAll(/<button\b/g)) {
        const attrs = finDeBalise(f.txt, m.index + 7);
        if (/onClick|onPress|onSubmit|type\s*=\s*["'`]submit|form\s*=|disabled|\{\.\.\./.test(attrs)) continue;
        // un bouton dans un <form> qui a un onSubmit est légitime
        const avant = f.txt.slice(Math.max(0, m.index - 700), m.index);
        if (/<form[^>]*onSubmit/.test(avant) && !/<\/form>/.test(avant.slice(avant.lastIndexOf('<form')))) continue;
        morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  <button> sans action`);
      }
      // gestionnaire vide
      for (const m of f.txt.matchAll(/\b(onClick|onSubmit|onPress)\s*=\s*\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\}/g)) {
        morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${m[1]} vide`);
      }
      // lien qui ne mène nulle part
      for (const m of f.txt.matchAll(/\bhref\s*=\s*["'`](#|)["'`]/g)) {
        morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  lien href="${m[1]}" (ne mène nulle part)`);
      }
    }
    out.push(['D6', 'D', 'BLOQUANT', `Boutons et liens qui ne font rien (${morts.length})`, morts,
      "Un élément qui a l'air cliquable et ne déclenche rien. L'utilisateur clique, il ne se passe rien, il pense que le produit est cassé : il a raison.\nSoit on le branche, soit on le retire de l'écran tant que la fonction n'existe pas."]);
  }

  /* D7 · Chiffre affiché en dur : le KPI inventé. */
  {
    const inventes = [];
    for (const f of ui) {
      // Contenu texte d'une balise : >  1 234  < ou > 87 % <
      for (const m of f.txt.matchAll(/>\s*(\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d+)?)\s*(%|€|\$|CHF|k|K|M)?\s*</g)) {
        const brut = m[1].replace(/[ .,]/g, '');
        const unite = m[2] || '';
        // On ignore 0, 1 et les petits compteurs sans unité : trop souvent des libellés.
        if (!unite && Number(brut) < 10) continue;
        if (/^(19|20)\d{2}$/.test(brut) && !unite) continue; // une année
        inventes.push(`${f.rel}:${lineAt(f.txt, m.index)}  affiche « ${m[1]}${unite ? ' ' + unite : ''} » en dur`);
      }
      // Un nombre littéral entre accolades, là où un enfant JSX attend une valeur :
      // `<b>{1247}</b>` à la place de `{resume.total}`. Mesuré à l'aveugle : 0/1 puis 0/1
      // de ces compteurs figés étaient vus. Pas en dessous de 10 (un rang, un index), pas
      // dans un attribut (`width={300}` est un réglage, pas un chiffre affiché).
      for (const m of f.txt.matchAll(/(?<=>|\}|[^=\s]\s)\s*\{\s*(\d{2,}(?:[.,]\d+)?)\s*\}(?=\s*(?:<|\{|\w|$))/gm)) {
        const avant = f.txt.slice(Math.max(0, m.index - 40), m.index);
        if (/=\s*$/.test(avant)) continue;                       // attribut, pas contenu
        inventes.push(`${f.rel}:${lineAt(f.txt, m.index)}  affiche « ${m[1]} » en dur (littéral entre accolades)`);
      }
      // Un nombre littéral interpolé dans un gabarit affiché : `${1247} abonnements`.
      for (const m of f.txt.matchAll(/\$\{\s*(\d{2,}(?:[.,]\d+)?)\s*\}/g)) {
        inventes.push(`${f.rel}:${lineAt(f.txt, m.index)}  affiche « ${m[1]} » en dur (nombre littéral interpolé dans un texte)`);
      }
      // Props de statistique alimentées par un littéral
      for (const m of f.txt.matchAll(/\b(value|valeur|count|nombre|total|montant|score|nb|pourcentage|progress)\s*=\s*\{?\s*["'`]?(\d[\d.,]{1,12})["'`]?\s*\}?/g)) {
        if (Number(String(m[2]).replace(/[.,]/g, '')) < 10) continue;
        inventes.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${m[1]}=${m[2]} en dur`);
      }
    }
    out.push(['D7', 'D', 'BLOQUANT', `Chiffres affichés en dur (${inventes.length})`, inventes,
      "Un chiffre à l'écran qui ne vient d'aucun calcul. C'est le défaut le plus dangereux d'un Data OS : le client lit un indicateur, le croit, et décide avec. Il n'a aucun moyen de savoir que le nombre est inventé, et il ne bougera jamais.\nTout chiffre affiché vient d'une lecture ou d'un calcul, sans exception."]);
  }

  /* D9 · Aucun écran pour la panne, le chargement ou l'introuvable.
     Relevé par l'oracle du banc : « les cinq écrans traitent undefined comme un
     chargement, donc une panne est indiscernable d'un chargement qui n'arrive jamais ».
     Next.js fournit trois fichiers pour ça et ne les invente pas : sans eux, une requête
     qui échoue emporte l'écran entier, et l'utilisateur voit une page blanche. */
  {
    const manques = [];
    const racines = [...new Set(files.map((f) => (f.rel.match(/^((?:src\/)?app)\//) || [])[1]).filter(Boolean))];
    for (const racine of racines) {
      const aEcrans = files.some((f) => new RegExp(`^${racine}/.*page\\.(tsx|jsx)$`).test(f.rel));
      if (!aEcrans) continue;
      for (const [nom, role] of [
        ['error', 'la panne'],
        ['loading', 'le chargement'],
        ['not-found', "l'introuvable"],
      ]) {
        const present = files.some((f) => new RegExp(`^${racine}/(.*/)?${nom}\\.(tsx|jsx)$`).test(f.rel));
        if (!present) manques.push(`${racine}/${nom}.tsx  absent — rien n'est prévu pour ${role}`);
      }
    }
    out.push(['D9', 'D', 'BLOQUANT', `États dégradés sans écran dédié (${manques.length})`, manques,
      "Sans ces fichiers, une requête qui échoue emporte l'écran entier et l'utilisateur voit une page blanche sans message. Pire : les écrans traitent l'absence de donnée comme un chargement, donc une panne d'intégration est indiscernable d'un chargement qui n'arrive jamais.\nC'est ce qui fait dormir une panne pendant des semaines."]);
  }

  // Deux sondes peuvent voir le même endroit : une ligne, une entrée.
  return out.map(([id, axe, grav, titre, items, detail]) => {
    const uniques = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${uniques.length})`), uniques, detail];
  });
}

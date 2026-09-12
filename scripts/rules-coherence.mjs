/**
 * AXE H — LA COHÉRENCE : comparer deux endroits du code.
 *
 * POURQUOI CET AXE EST LE PLUS IMPORTANT DE TOUS.
 *
 * Mesure du 11/09/2026 sur un banc d'essai : un lecteur humain attentif trouve 74 défauts
 * dans le périmètre de ce skill ; les détecteurs en attrapent 23, soit 31 %. Les deux
 * tiers manquants ont tous la même forme : **le défaut n'est dans aucune ligne, il est
 * dans l'écart entre deux lignes.**
 *
 *   « Le chiffre d'affaires est défini deux fois. Une version exclut les clients archivés
 *     et ne borne aucune période ; l'autre borne au mois et n'exclut pas les archivés.
 *     Deux écrans, deux chiffres, aucun moyen de savoir lequel est bon. »
 *
 * Aucun détecteur classique ne voit ça : chaque ligne, prise seule, est correcte. Et
 * aucun outil du marché ne le fait non plus — jscpd trouve le copier-coller, pas deux
 * formules différentes qui prétendent calculer la même chose.
 *
 * La méthode est pourtant mécanique. Pour chaque grandeur nommée, on calcule une
 * empreinte de la façon dont elle est calculée. Deux empreintes différentes sous le même
 * nom, c'est une divergence. C'est tout, et ça se vérifie sans comprendre le métier.
 */

const INDICATEUR = /^(ca|chiffreAffaires|revenue|encaisse|encaissement|montantTotal|total\w*|somme\w*|nb\w+|nombre\w+|count\w*|taux\w+|rate\w*|ratio\w*|pct\w*|pourcentage\w*|moyenne\w*|average|avg\w*|cpl|cpa|roas|roi|marge|benefice|profit|panier\w*|conversion\w*|actifs?|clients?Actifs|leads?\w*|factures?\w+|impayes?|enRetard|enAttente|recouvrement|showRate|closeRate)$/i;

// Une expression qui calcule vraiment quelque chose, par opposition à une chaîne, une
// classe CSS ou un libellé. Sans ce filtre, on compare des noms de couleurs.
const CALCULE = /\.(length|size|reduce|filter|map)\b|[+\-*/]|Math\.|Number\(|parseInt|parseFloat|new Set\(/;

export default function reglesCoherence({ files, lineAt }) {
  const out = [];
  const code = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f.rel) && !/\.(test|spec)\./.test(f.rel));
  const backend = code.filter((f) => /^convex\//.test(f.rel) || /\/(server|api|lib)\//.test(f.rel));

  /* ───────────────────────────────────────────────────────────────────────
     H1 · Deux lectures de la même table, deux jeux de critères.

     Première version de cette règle : comparer les FORMULES. Échec mesuré sur le banc,
     elle ratait le défaut qu'elle visait. La raison est instructive : deux endroits qui
     calculent le chiffre d'affaires ne se ressemblent pas du tout en tant qu'expressions
     (une boucle ici, une fonction d'agrégation là). La divergence n'est pas dans le
     calcul, elle est dans **ce qu'on décide de compter**.

       clients.ts   : isDemo !== true && payeeLe !== undefined && visibles.has(clientId)
       dashboard.ts : payeeLe >= debutMois && payeeLe < maintenant

     Le premier exclut les clients archivés et ne borne aucune période ; le second borne
     au mois et n'exclut pas les archivés. Même table, même grandeur, deux populations.
     C'est ce que le client voit comme « les deux écrans ne disent pas la même chose ».

     La règle compare donc les CRITÈRES employés table par table, et signale ceux qui
     n'apparaissent que dans une partie des lectures.
  ─────────────────────────────────────────────────────────────────────── */
  {
    // Critères qui changent la population comptée. Un critère utilisé ici et oublié là
    // est exactement la façon dont deux chiffres divergent sans que personne ne mente.
    const CRITERES = /\b(isDemo|isTest|estDemo|estTest|archiv\w*|estArchive|supprime\w*|deleted|payeeLe|paidAt|statut|status|estClient|visibles?|actifs?|annule\w*|rembourse\w*|refunded|brouillon|draft)\b/gi;

    // Un critère appliqué à travers un helper (estFactureReelle, sansDemo…) est
    // appliqué quand même. Sans cette résolution, on signale le code bien fait, ce qui
    // est la pire chose qu'un détecteur puisse faire.
    const helpers = new Map(); // nom de fonction → Set(critères qu'elle applique)
    for (const f of code) {
      for (const m of f.txt.matchAll(/(?:function|const)\s+(\w{4,})\s*[=(][\s\S]{0,300}?(?:\n\}|=>[^\n]{0,200})/g)) {
        const trouves = new Set((m[0].match(CRITERES) || []).map((x) => x.toLowerCase()));
        if (trouves.size) helpers.set(m[1], trouves);
      }
    }

    const parTable = new Map(); // table → [{lieu, criteres:Set, extrait}]
    for (const f of code) {
      for (const m of f.txt.matchAll(/\.query\(\s*["\'`](\w+)["\'`]\s*\)([\s\S]{0,400}?)(?:;|\n\s*\n)/g)) {
        const table = m[1], suite = m[2];
        if (!/filter|withIndex|\.eq\(|=>/.test(suite)) continue;   // une lecture sans critère ne dit rien
        const criteres = new Set((suite.match(CRITERES) || []).map((x) => x.toLowerCase()));
        // Les critères apportés par les helpers appelés dans cette lecture.
        for (const appel of suite.matchAll(/\b(\w{4,})\s*\(/g)) {
          const h = helpers.get(appel[1]);
          if (h) for (const c of h) criteres.add(c);
        }
        if (!criteres.size) continue;
        if (!parTable.has(table)) parTable.set(table, []);
        parTable.get(table).push({
          lieu: `${f.rel}:${lineAt(f.txt, m.index)}`,
          criteres,
          extrait: suite.replace(/\s+/g, ' ').slice(0, 80),
        });
      }
    }

    const divergences = [];
    for (const [table, lectures] of parTable) {
      if (lectures.length < 2) continue;
      // Un critère employé par certains lecteurs et pas par d'autres : c'est là que les
      // deux chiffres se séparent.
      const tous = new Set();
      for (const l of lectures) for (const c of l.criteres) tous.add(c);
      for (const critere of tous) {
        const avec = lectures.filter((l) => l.criteres.has(critere));
        const sans = lectures.filter((l) => !l.criteres.has(critere));
        if (!avec.length || !sans.length) continue;
        // Une minorité qui l'oublie est un oubli ; un partage 50/50 est souvent
        // une différence de rôle assumée (une vue d'archive existe légitimement).
        if (sans.length > avec.length) continue;
        divergences.push(
          `« ${table} » : le critère « ${critere} » est appliqué par ${avec.length} lecture(s) et oublié par ${sans.length}\n` +
          sans.slice(0, 3).map((x) => `         oublié : ${x.lieu}  →  ${x.extrait}`).join('\n') +
          `\n         appliqué : ${avec[0].lieu}`,
        );
      }
    }

    out.push(['H1', 'H', 'BLOQUANT', `Critères de sélection incohérents sur une même table (${divergences.length})`, divergences,
      "Deux écrans lisent la même table et ne comptent pas la même population : l'un exclut les archivés, l'autre non ; l'un borne la période, l'autre non. Les deux chiffres sont affichés avec le même aplomb, et rien ne dit lequel est le bon.\nC'est la forme la plus fréquente du chiffre faux, et aucune ligne prise seule n'est fautive : le défaut vit dans l'écart.\nRègle : un critère qui définit la population comptée appartient à une fonction unique, pas à chaque appelant."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     H2 · Deux grilles de jours dans le même produit.
     Un écran calcule « ce mois » en temps universel, l'autre en heure locale. Le même
     bouton de période rend deux chiffres différents. Vu aussi avec un signe de décalage
     horaire inversé entre deux écrans qui appellent la MÊME requête.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const grilles = new Map(); // forme → [lieux]
    const FORMES = [
      [/getTimezoneOffset\(\)/g, 'décalage du navigateur'],
      [/-\s*new Date\(\)\.getTimezoneOffset\(\)/g, 'décalage INVERSÉ (signe opposé)'],
      [/\.toISOString\(\)\.slice\(0,\s*10\)|\.toISOString\(\)\.split\(["'`]T["'`]\)/g, 'jour en temps universel'],
      [/setUTCHours\(|Date\.UTC\(/g, 'bornes en temps universel'],
      [/setHours\(0,\s*0,\s*0/g, 'bornes en heure locale'],
      [/toLocaleDateString\(/g, 'date au format local'],
    ];
    for (const f of code) {
      for (const [re, forme] of FORMES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(f.txt))) {
          if (!grilles.has(forme)) grilles.set(forme, []);
          grilles.get(forme).push(`${f.rel}:${lineAt(f.txt, m.index)}`);
        }
      }
    }
    const items = [];
    const utc = grilles.get('bornes en temps universel') || grilles.get('jour en temps universel') || [];
    const local = grilles.get('bornes en heure locale') || [];
    const inverse = grilles.get('décalage INVERSÉ (signe opposé)') || [];

    if (utc.length && local.length) {
      items.push(`Deux grilles de jours coexistent : ${utc.length} calcul(s) en temps universel et ${local.length} en heure locale\n` +
        `         universel : ${utc.slice(0, 3).join(', ')}\n         local     : ${local.slice(0, 3).join(', ')}`);
    }
    if (inverse.length) {
      for (const l of inverse) items.push(`${l}  décalage horaire au signe inversé — la frontière de journée est décalée du double`);
    }
    out.push(['H2', 'H', 'BLOQUANT', `Grilles de jours incohérentes (${items.length})`, items,
      "« Aujourd'hui » ne désigne pas la même chose selon l'écran. Un encaissement du 1er à 00h30 compte dans le mois précédent sur un écran et dans le bon mois sur l'autre, et les deux totaux divergent sans que personne ne sache lequel croire.\nRègle : une seule fonction de découpage du temps dans tout le produit, et le décalage vient d'elle, jamais d'une expression écrite au site d'appel."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     H3 · Un total et son détail qui ne parlent pas de la même chose.
     La même fonction d'agrégation appelée deux fois dans le même corps avec des bornes
     différentes : la carte du haut est à vie, le graphique du bas sur la période choisie,
     et un seul sélecteur de dates pilote l'écran.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const items = [];
    for (const f of backend) {
      // Deux appels de la même fonction dans le même corps, avec des arguments distincts.
      const appels = new Map();
      for (const m of f.txt.matchAll(/\b(\w{4,})\s*\(\s*\{([^{}]{0,160})\}\s*\)/g)) {
        const fn = m[1], args = m[2].replace(/\s+/g, ' ').trim();
        if (/^(if|for|while|switch|catch|return|console|require|import|expect)$/.test(fn)) continue;
        // Les validateurs et les définitions de schéma ne sont pas des agrégations.
        if (/^(object|array|union|optional|literal|record|defineTable|defineSchema|query|mutation|action|internalQuery|internalMutation|internalAction)$/.test(fn)) continue;
        // Empiler dans un tableau n'est pas agréger : `push({from, to})` deux fois de
        // suite est un motif normal, pas un total qui diverge de son détail.
        if (/^(push|set|add|append|insert|emit|log|track|send)$/.test(fn)) continue;
        const avant = f.txt.slice(Math.max(0, m.index - 30), m.index);
        if (/\bv\.\s*$|args\s*:\s*$|returns\s*:\s*$/.test(avant)) continue;
        if (!/from|to|since|until|debut|fin|start|end|periode|month|jour/i.test(args)) continue;
        if (!appels.has(fn)) appels.set(fn, []);
        appels.get(fn).push({ args, ligne: lineAt(f.txt, m.index) });
      }
      for (const [fn, liste] of appels) {
        if (liste.length < 2) continue;
        const formes = new Set(liste.map((x) => x.args));
        if (formes.size < 2) continue;
        items.push(`${f.rel}  « ${fn} » appelée ${liste.length}× avec des périodes différentes dans le même corps :\n` +
          liste.slice(0, 3).map((x) => `         ligne ${x.ligne} : { ${x.args.slice(0, 70)} }`).join('\n'));
      }
    }
    out.push(['H3', 'H', 'À TRAITER', `Total et détail sur des périodes différentes (${items.length})`, items,
      "La même fonction d'agrégation appelée deux fois avec des bornes différentes dans le même écran : le grand chiffre du haut et le tableau du dessous ne parlent pas de la même période. Le client additionne le détail et tombe sur autre chose.\nC'est parfois volontaire (une carte à vie, un graphique sur la période) : dans ce cas, l'écran doit le dire, et la ligne doit être annotée."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     H4 · Deux façons de mettre en forme la même grandeur.
     Un formateur arrondit à l'unité, l'autre garde deux décimales : le même montant
     s'affiche 1 250 € ici et 1 250,49 € là. Et le commentaire du fichier affirme
     qu'il n'y a qu'un seul formateur dans l'application.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const formateurs = [];
    for (const f of code) {
      for (const m of f.txt.matchAll(/(?:function|const)\s+(\w*(?:format|affich|render|display)\w*)\s*[=(]([\s\S]{0,300}?)(?:\n\}|\n\s*\})/gi)) {
        const corps = m[2];
        if (!/Intl\.NumberFormat|toLocaleString|toFixed|currency/i.test(corps)) continue;
        const signature = [
          /minimumFractionDigits\s*:\s*(\d)/.exec(corps)?.[1] ?? '?',
          /maximumFractionDigits\s*:\s*(\d)/.exec(corps)?.[1] ?? '?',
          /toFixed\((\d)\)/.exec(corps)?.[1] ?? '',
          /style\s*:\s*["'`](\w+)/.exec(corps)?.[1] ?? '',
        ].join('/');
        formateurs.push({ nom: m[1], lieu: `${f.rel}:${lineAt(f.txt, m.index)}`, signature });
      }
    }
    const items = [];
    const signatures = new Set(formateurs.map((x) => x.signature));
    if (formateurs.length > 1 && signatures.size > 1) {
      items.push(`${formateurs.length} formateurs de montant avec ${signatures.size} réglages différents :\n` +
        formateurs.slice(0, 5).map((x) => `         ${x.lieu}  ${x.nom}  (décimales ${x.signature})`).join('\n'));
    }
    out.push(['H4', 'H', 'À TRAITER', `Mises en forme divergentes d'une même grandeur (${items.length})`, items,
      "Le même montant ne s'affiche pas pareil selon l'écran : arrondi à l'unité d'un côté, deux décimales de l'autre. Le client croit voir deux valeurs alors qu'il n'y en a qu'une, et les centimes disparaissent des totaux.\nUn seul formateur par type de grandeur, importé partout."]);
  }

  /* ───────────────────────────────────────────────────────────────────────
     H5 · Un seuil ou une constante métier répété avec deux valeurs.
     Une durée de rendez-vous codée à 30 minutes ici et 45 minutes là ; un délai
     d'échéance à 30 jours dans le cron et 60 dans l'écran.
  ─────────────────────────────────────────────────────────────────────── */
  {
    const constantes = new Map(); // concept → Set(valeurs) + lieux
    const CONCEPTS = /\b(duree|delai|echeance|retard|timeout|expiration|limite|seuil|max\w*|min\w*|tva|commission|remise)\w*\b/i;
    for (const f of code) {
      for (const m of f.txt.matchAll(/\b(\w*(?:duree|delai|echeance|retard|timeout|expiration|limite|seuil|tva|commission|remise)\w*)\s*[=:]\s*(\d+(?:\.\d+)?)\b/gi)) {
        const concept = m[1].toLowerCase().replace(/[_-]/g, '');
        if (!CONCEPTS.test(concept)) continue;
        if (!constantes.has(concept)) constantes.set(concept, new Map());
        constantes.get(concept).set(m[2], `${f.rel}:${lineAt(f.txt, m.index)}`);
      }
    }
    const items = [];
    for (const [concept, valeurs] of constantes) {
      if (valeurs.size < 2) continue;
      // Deux valeurs dans un seul fichier sont presque toujours deux réglages différents
      // (un délai court et un long). La divergence commence quand deux FICHIERS ne
      // s'accordent pas sur la même règle.
      const fichiers = new Set([...valeurs.values()].map((l) => l.split(':')[0]));
      if (fichiers.size < 2) continue;
      items.push(`« ${concept} » vaut ${valeurs.size} valeurs différentes : ` +
        [...valeurs.entries()].map(([v, l]) => `${v} (${l})`).join(' · '));
    }
    out.push(['H5', 'H', 'À TRAITER', `Constantes métier divergentes (${items.length})`, items,
      "La même règle métier écrite avec deux valeurs différentes selon l'endroit. Le produit se comporte différemment selon le chemin emprunté, et personne ne sait laquelle est la bonne.\nUne constante métier a un seul propriétaire, exporté depuis un module unique."]);
  }

  return out.map(([id, axe, grav, titre, items, detail]) => {
    const u = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${u.length})`), u, detail];
  });
}

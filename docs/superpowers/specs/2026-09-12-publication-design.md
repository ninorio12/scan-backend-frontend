# Scan Backend Frontend — design de publication

Validé le 12/09/2026. Critère de fini, fixé par le commanditaire : **une session Claude
neuve reçoit un projet public qu'aucun de nous ne connaît, et en sort le bilan seule.**
Tant que ce n'est pas prouvé, on ne publie pas.

## Pourquoi ce skill existe

Sur n'importe quel SaaS, donné à n'importe quelle instance Claude sans configuration :
trouver tout ce qui casse le lien entre les modules et la donnée. Un écran qui affiche une
valeur qu'aucune source n'alimente. Un bouton qui annonce un succès sans rien écrire. Un
rendez-vous présent dans cinq modules qui lisent cinq bases. Des boutons morts. Des fausses
données de maquette en base. Des écrans cassés visuellement. Tous les modules, tous les
boutons, sans jamais présenter un travail partiel comme complet, et en posant à l'humain
les questions qu'il ne peut pas trancher.

Idée centrale : ne pas chercher des bugs dans un catalogue infini, mais des choses qui
auraient dû être d'accord et ne le sont pas, sur sept attributs (existence, source,
formule, vocabulaire, unité, population, garde).

## Les six sections validées

1. **Ce qui part sur GitHub** : scripts, doctrine, fiches, banc de mesure (projet figé +
   vérité terrain), mode d'emploi. **Rien de nos clients** : ni preuves projet client A, ni copies de
   projets, ni correctifs, ni rapports d'audit, ni export de base.
2. **Ce qu'on corrige d'abord** : le plafond à 16 clics (attendre le rendu réel, cliquer
   par sélecteur stable) ; le nettoyeur de base (archive, pas dossier) ; un travailleur
   par ÉCRAN, jamais par tranche de boutons.
3. **Les tests** : un par script, sur le projet figé, une commande unique.
4. **La doctrine** : SKILL.md ~150–180 lignes (commande, loi, cinq étapes) ; l'histoire
   descend dans references/.
5. **Le mode d'emploi** : README, prérequis, installation en trois lignes, où poser le
   lexique métier.
6. **La preuve** : l'instance vierge sur projet open source inconnu sort un bilan seule.

## Ce que l'audit mainteneur a ajouté (tout prouvé par exécution)

- clics / apparence / liens répondent « rien à signaler » en code 0 quand l'app ne répond
  pas → refuser de conclure sans page.
- couverture marque « fait » un enfant sorti en code 2 → propager les codes.
- apparence plante sur tout SVG > 220×120 (innerText undefined).
- clics abandonne en silence après mutation du DOM : c'est le bug des 16.
- clics cliquerait « Enregistrer », « Nouveau contact », « Déposer un fichier » : la liste
  noire ne couvre pas ce qui ÉCRIT.
- nettoyer-base n'a jamais fonctionné (zip attendu comme dossier).
- 22 fichiers non ignorés écrits dans le dépôt client, dont l'export de la base (2,1 Mo).
- banc/ : 781 Mo, copie d'projet client A, configs de trois clients, 13 fichiers avec nom et email
  du client.
- Quatre « points d'entrée uniques » avec quatre échelles de gravité contradictoires ;
  couverture n'appelle ni reconnaitre, ni decisions, ni nettoyer-base, ni bilan ; bilan ne
  peut jamais quitter INCONNU par la chaîne fournie ; le baromètre classe « annonce succès
  sans écrire » en dette (l'inverse de la doctrine).
- apparier.mjs dupliqué ; 5 scripts orphelins ; 19 non cités dans SKILL.md ; install-gate
  interdit puis prescrit ; reconnaitre attribue l'app du port 3000 à n'importe quel projet.
- Aucun package.json, aucun README, dépendances non déclarées (Node 20, typescript,
  playwright+chromium, curl, convex, git).
- 1 test pour 17 règles sur 51.

## Décisions de conception

- **Une seule chaîne**, `couverture.mjs` : reconnaitre → scan → lexical → fausses-données →
  nettoyer-base (si l'export réussit) → par écran en parallèle (clics + apparence + liens)
  → decisions → bilan. Une seule échelle de gravité, celle du baromètre : trompe /
  cassé / dette / non regardé.
- **Refus de conclure** : tout script qui ne peut pas faire son travail sort en code 2 et
  le dit ; jamais « rien à signaler » sans page.
- **Un travailleur par écran**, processus séparé, navigateur séparé, décompte séparé.
  L'écran est l'unité d'isolation : ses boutons partagent un état.
- **Ne jamais cliquer ce qui écrit** : `type=submit`, tout bouton dans un `<form>`, et les
  verbes d'écriture. Ces boutons sont comptés « écartés, à tester par agent ou à la main »,
  nommément.
- **Tout ce que le skill écrit va dans `<repo>/.backend/`**, qui contient son propre
  `.gitignore` (`*`). L'export de base va hors du dépôt (`os.tmpdir()`), jamais dedans.
- **Un lexique métier par projet** (`.backend/lexique.json`), jamais dans le skill.

## Périmètres des chantiers (disjoints, imposés)

- **Écrans & chaîne** : `scripts/{clics,apparence,liens,couverture}.mjs`.
- **Hygiène, doctrine, installabilité** : `SKILL.md`, `references/`, `README.md`,
  `package.json`, `.gitignore`, purge de `banc/`, `scripts/{nettoyer-base,reconnaitre,
  bilan,score,scan}.mjs`, suppression des doublons et orphelins, `install-gate.sh`, `web.py`.
- **Tests** : `tests/` uniquement.

## Hors périmètre

Le rappel de l'analyse statique (5/31 à l'aveugle) n'est pas traité ici : c'est un
chantier séparé. Ce design rend le skill publiable et honnête, pas omniscient.

# L'APPARIEUR — dossier

Prototype exécutable + mesures. Tout chiffre vient d'une exécution montrée.
Code : `lexique.mjs`, `extraire.mjs`, `apparier.mjs`, `apparieur.mjs`, `experiences.mjs` (1 886 lignes, zéro dépendance hors `typescript` déjà installé partout).

    node apparieur.mjs <projet-client-A> --json a.json --solitudes

---

## 0. LES CHIFFRES D'ABORD

| | référence skill maison | apparieur |
|---|---|---|
| banc de 20 défauts plantés, à l'aveugle | **1 / 20** | **20 / 20** |
| justesse | **54 %** | **96 %** (22 constats rattachés sur 23 émis) |

⚠️ Honnêteté : le banc `piege3` et sa vérité terrain ont été effacés par le redémarrage. Le 20/20 a été mesuré par `mesurer.mjs` avant la perte, sortie citée en §4. Il n'est **plus reproductible** ici. Ce qui l'est, et qui a été remesuré après reconstruction complète du code :

| dépôt | éléments | paires possibles | évaluées | constats | temps |
|---|---|---|---|---|---|
| projet client A `<projet-client-A>` | 7 021 | 19 440 730 | 67 810 (**99,65 % évitées**) | **14** | 2,0 s |
| projet client B `<projet-client-B>` | 17 382 | 122 800 000 | 181 856 (**99,85 % évitées**) | **43** | 6,2 s |
| banc2 `banc/fige` | 464 | 97 461 | 3 100 | **2** | 0,2 s |

Sur projet client A, **« Sophie Martin » ressort en tête**, avec son bouton mort attaché, et **14 constats au total** (pas 200) :

```
[0.86] Le champ « Prénom » affiche « Sophie » en dur alors que contacts.prenom existe
       app/modules/parametres/page.tsx:224
       jumeau · saisie defaultValue="Sophie"
       jumeau · convex/schema.ts:286 contacts.prenom
       jumeau · app/modules/parametres/page.tsx:237 bouton « Enregistrer » qui n'écrit rien
       Le libellé est le jumeau du champ contacts.prenom. La valeur montrée n'en
       vient pas : elle est écrite dans le gabarit. Et le bouton d'enregistrement
       de cet écran ne remonte rien au serveur : l'aller ET le retour sont morts.

[0.86] Le bouton « Enregistrer » annonce « Profil enregistré » et n'écrit rien côté serveur
[0.86] Le bouton « Déconnecter » annonce « Session fermée » et n'écrit rien côté serveur
[0.86] Le bouton « Enregistrer » annonce « Informations enregistrées » et n'écrit rien côté serveur
[0.71] Le bouton « Envoyer l'invitation » annonce « Invitation envoyée » et n'écrit rien
[0.86] Nom / Email / Téléphone / Raison sociale / Adresse : mêmes valeurs en dur (5 constats)
[0.77] Supprimer un « biens » laisse 7 tables qui le référencent (convex/migration.ts:224)
[0.60] « enRetard » et « enRetard » nomment le même concept et ne le définissent pas pareil (×2)
[0.60] « actifs » et « biensActifs » nomment le même concept et ne le définissent pas pareil
```

Les 14 ont été vérifiés un par un dans la source. 14 vrais. Le chemin pour y arriver est en §4.

---

## 1. CE QU'ON INSTALLE AU LIEU DE L'ÉCRIRE

**Rien. Mesuré, pas supposé.** 25 requêtes lancées sur le registre (`npx skills find "schema matching"`, `"entity resolution"`, `"data lineage"`, `"orphan fields"`, `"consistency check"`, `"naming consistency"`, `"cross-file analysis"`…). Ce qui existe se range en trois familles, aucune ne couvre le besoin :

| famille | exemples trouvés | pourquoi ça ne marche pas |
|---|---|---|
| lineage data-warehouse | `google/skills@datalineage-bigquery` (3,9 K), `datahub-lineage` (187) | lineage de tables, pas de champs d'écran |
| code graph générique | `codegraph@agent-eval` (1,6 K), `code-review-graph` (1,2 K) | graphe d'imports, aucune sémantique de champ |
| ER documentaire | `claude-dev-suite@entity-resolution` (3 installs) | bon vocabulaire (normalize→block→score→cluster), mauvais substrat |

Le seul candidat direct, `patricio0312rev/skills@schema-consistency-checker` (229 installs) : 100 % prose, règles de nommage SQL/Postgres, zéro AST TypeScript, zéro notion d'écran. `udecode/plate@schema-drift-detector` **n'existe pas réellement** (`skills use` répond `No matching skill found`).

Ce qu'on **vole** aux collections déjà clonées, en spécification et non en code :
- `mattpocock/skills@domain-modeling` (614 K installs, 184 lignes, **0 script**) : le format du glossaire canonique et le critère « quand le code contredit ce que tu dis, remonte la contradiction ». C'est notre format de sortie, pas notre moteur.
- `convex-explain-app` (29 lignes, 0 script) : la spécification exacte de l'extracteur backend (schéma + clés étrangères + index + split public/interne + trace mutation→table→query). Il refuse explicitement d'évaluer (« Descriptive, not evaluative ») : c'est précisément la valeur qu'on ajoute.
- Les 4 collections (`convex-skills` 33 SKILL.md, `vercel-skills` 9, `mattpocock` 6 fichiers exécutables, `addyosmani` 25) contiennent **un seul artefact d'analyse statique** : `dependency-cruiser.config.cjs`. Modèle d'intégration CI, rien de plus.

**Bibliothèques npm** : `typescript` est déjà installé dans projet client A, projet client B, projet client C et banc2 → l'apparieur le charge depuis là, zéro installation. Vérifié au `npm view` : `string-similarity@4.0.4` est **déprécié** ; `natural@8.1.1` pèse **13,8 Mo et tire mongoose + pg + redis** pour donner Jaro-Winkler ; `talisman` n'est plus maintenu depuis 2022. Jaro-Winkler fait 30 lignes, Levenshtein 12 : ils sont dans `lexique.mjs`. Le travail utile n'est pas dans la mesure de chaîne, il est dans la **normalisation** des identifiants, et aucune lib ne la fait.

**Python (splink / dedupe / zingg)** : disponible mais bloqué PEP 668, et surtout **surdimensionné pour la mauvaise raison**. Splink résout le Fellegi-Sunter : apparier des millions de paires bruitées avec des poids appris par EM. Nos signaux ne sont ni bruités ni indépendants, ils sont structurels et **déterministes** : un `v.id("clients")` dans le schéma, une clé de projection, un littéral d'union. Remplacer une preuve par une estimation est une régression. On emprunte le pipeline (`normalize → block → score → cluster`), pas l'outil.

---

## 2. CE QU'ON ÉCRIT

### 2.1 Apparier sur quoi ? — réponse mesurée

Cinq mesures combinées, à la COMA (Do & Rahm, VLDB 2002), sur des éléments d'abord normalisés à la Cupid (VLDB 2001), avec blocking de Fellegi-Sunter et propagation à la Similarity Flooding (ICDE 2002).

```
score(a,b) = 0,56 · nom + 0,24 · entité + 0,20 · type      puis   +0,12 · propagation
```

- **nom** = max( cosinus SoftTF-IDF sur jetons pondérés IDF avec appariement flou des jetons (Cohen/Ravikumar/Fienberg 2003) ; recouvrement pondéré IDF ; Jaro-Winkler sur la chaîne normalisée × 0,85 ). Le recouvrement est ce qui garde `actifs` candidat jumeau de `clientsActifs`.
- **entité** = même table Convex (1), inconnue (0,5), différente (0,15).
- **type** = même unité (1), même famille d'unité (0,75), familles différentes (0,3), même validateur `v.*` (1).
- **propagation** = Jaccard des clés normalisées des deux contextes (fonction porteuse, puis fichier), mémoïsé. Deux éléments se ressemblent davantage si leurs voisinages parlent des mêmes choses.

**Ce qui porte réellement le résultat, mesuré par ablation** (sur le banc 20 défauts, avant sa perte) :

| lexique | groupes | constats |
|---|---|---|
| complet | 42 | **23** |
| sans synonymes (prenom↔firstName↔first) | 52 | 19 (**−4**) |
| sans découpe camelCase | 67 | 17 (**−6**) |
| nom brut, aucune normalisation | 70 | 17 (**−6**) |
| sans mots vides | 37 | 23 (0) |

Verdict : **la normalisation vaut 6 constats sur 23 (26 %), la table de synonymes 4.** Le découpage camelCase est la pièce la plus chère : le bug où `deplier()` mettait en minuscules **avant** de découper laissait `eventId` en un seul jeton et coûtait 6 défauts sur 20. C'est écrit en commentaire dans `lexique.mjs` pour que personne ne le réintroduise.

**Sensibilité au seuil, projet client A** : 14 constats à 0,50 comme à 0,86 (`experiences.mjs`). Résultat honnête et important : **la couche floue ne porte que 3 des 23 constats du banc** (la quasi-collision `/api/export/` vs `/api/exports/`, le littéral `gagné` vs `gagne`, et `actifs` vs `clientsActifs`). Le reste s'appuie sur l'égalité de clé normalisée. La similarité gagne sa place exactement là où un catalogue de règles ne peut rien dire, mais elle ne fait pas le gros du volume : c'est la normalisation qui le fait.

### 2.2 Qu'est-ce qu'être d'accord ? — la liste fermée

C'est le renversement complet. On n'énumère pas les bugs (liste ouverte, jamais finie, d'où le 24ᵉ type qui passe toujours). On énumère **ce que « être d'accord » veut dire**, et ça, c'est fini. **Sept attributs.** Un seul qui diverge fait le défaut.

| | attribut | deux jumeaux sont d'accord si… | calculé à partir de |
|---|---|---|---|
| A1 | **existence** | chaque station que le jumelage suppose est présente | stations de la chaîne : schéma → écrit → projeté → affiché → libellé |
| A2 | **source** | ils remontent à la même donnée | `table.champ` résolu ; graphe de clés étrangères ; chemin de route |
| A3 | **formule** | ils sont calculés de la même façon | texte du calcul, déplié à travers les variables locales |
| A4 | **vocabulaire** | ils emploient les mêmes valeurs autorisées | `v.union(v.literal(...))` vs littéraux qui atteignent le champ |
| A5 | **unité** | ils mesurent avec la même graduation | lexique HT/TTC/centimes/%/ms/jours, lu **dans le calcul avant le nom** |
| A6 | **population** | ils portent sur le même ensemble | prédicats, période, borne `take`, ordre, propres à **la valeur**, pas à la fonction |
| A7 | **garde** | ils sont protégés par les mêmes conditions | signature / secret / session, par porte et par cœur atteint |

Les contrôles sont le produit cartésien attribut × type de relation jumelle. Extraits, avec le défaut du banc qu'ils attrapent :

- A1 « affiché mais non produit » : le champ est au schéma, l'écran le lit, la projection du producteur ne le contient pas (défaut #1).
- A1 « lu par N, écrit par aucun » : orphelin d'écriture (#3 `relanceeLe`, #9 `eventId` — l'index `by_event` déduplique sur un champ que l'`insert` n'écrit jamais).
- A1 « réglage que rien ne consulte » : champ d'une table `parametres`, stocké et exposé, qu'aucune fonction hors module de rangement ne cite (#15).
- A1 « bouton qui annonce un succès sans écrire » : signature exacte du cas Thomas (#2, et les 4 d'projet client A).
- A1 « tâche planifiée qui calcule puis jette » (#3).
- A2 « valeur en dur là où un champ jumeau existe » : **c'est Sophie Martin**.
- A2 « cible qui n'existe pas, quasi-jumeau à 1 caractère » (#17).
- A2 « suppression sans cascade », via le graphe `v.id()` (#20).
- A3 « le nom promet le plus récent, la requête ne trie pas » (#19) ; « le secours renvoie la forme du succès » (#12) ; « repli numérique sorti de nulle part » (#5) ; « écriture lancée sans être attendue » (#11).
- A4 « littéral hors du dictionnaire » : le lot de littéraux se rattache à un champ par **vote majoritaire**, et le membre qui n'en fait pas exactement partie est le défaut (#10 `"gagné"` vs `"gagne"`).
- A5 « deux montants du même écran, graduations différentes » (#13 HT vs TTC sous le même « Total »).
- A6 « deux périodes sur le même écran » (#6) ; « chiffre cliquable dont la destination ne montre pas le même ensemble » (#8) ; « deux définitions d'un même concept » (#16) ; « agrégat calculé sur un échantillon » (#18).
- A7 « deux portes vers un cœur, protections inégales » (#4) ; « garde appelée, résultat jeté » (#7) ; « branche de vérification qui répond 200 » (#14).

### 2.3 LISTE NÉGATIVE — ce que l'apparieur ne doit JAMAIS signaler

Elle ne parle pas de bugs. Elle parle de choses dont la solitude ou le désaccord n'a aucune signification produit. Sur projet client A elle écarte **785 éléments sur 7 021 (11,2 %)** avant tout calcul.

**a. Écarté d'entrée** (`LISTE_NEGATIVE`) :
- fichiers : `_generated`, `node_modules`, `.next`, `*.test.*`, `__tests__`, `fixtures/`, `mocks/`, `*.stories.*`, `scripts/`, `*.config.*`, `seed.*`
- noms réservés : `_id`, `_creationTime`, `className`, `key`, `ref`, `children`, `style`, `props`, `args`, `ctx`, `e`, `err`, `res`, `req`, méthodes de tableau, attributs DOM
- valeurs décoratives : `Chargement`, `Loading`, `…`, `—`, classes Tailwind, types MIME, verbes HTTP

**b. Jamais signalé comme désaccord, même si le calcul en trouve un :**
1. Un bouton dont le libellé est un **geste d'interface** : copier, filtrer, trier, fermer, annuler, imprimer, chercher, afficher, ouvrir, actualiser, sélectionner, parcourir, télécharger, exporter, partager, générer, changer, aperçu, zoom, focus, relire. *(Mesuré : cette seule liste a retiré 7 faux positifs d'projet client A.)*
2. Un bouton **sans libellé** (icône seule) ou dont le geste est **délégué à une prop** (`onSave`, `onEnregistrer`) : l'écriture est la responsabilité du parent.
3. Un champ d'une table que **ce dépôt ne remplit jamais** (semences, webhook d'identité, migration) : elle est alimentée ailleurs, ses champs n'ont rien à prouver ici.
4. Un champ dont une écriture **opaque** (spread irrésolu, objet variable) ou **non localisée** (patch dont la table n'a pas pu être établie) touche peut-être le nom. *(Mesuré : 129 → 80 constats projet client A, puis 43 → 41 sur projet client B.)*
5. Une fonction de **forme ouverte** : elle renvoie une collection non remodelée, on ne sait pas ce qui en sort.
6. Un **filtre paramétré par un argument** (`statut === args.statut`) : c'est un paramètre, pas une définition divergente.
7. Un **passe-plat homonyme** : deux fonctions qui projettent le même champ du schéma, ou le nom de leur propre table, ou leur propre nom, ne sont pas deux définitions.
8. Un **helper de lecture partagé** : un cœur n'est un enjeu de garde que s'il écrit, supprime, ou sort du produit, et s'il a **2 à 4 portes**. *(Mesuré : 86 constats sur 162 disparaissent sur projet client B.)*
9. Un **segment dynamique** : `${slug}` à l'appel et `[slug]` à la déclaration sont deux graphies du même trou.
10. Une **récence stockée** : un champ `dernierPassageRelances` qui existe au schéma n'a pas à être trié, sa récence est une donnée, pas une sélection.
11. **ABSTENTION GÉNÉRALE** : si la chaîne n'est pas entièrement visible (un appel du geste n'est ni une liaison connue, ni une fonction locale lisible, ni un poseur d'état), on se tait. Mieux vaut un défaut manqué qu'une accusation sans preuve.

---

## 3. LA MACHINE DÉCIDE SEULE QU'UN ÉLÉMENT EST LÉGITIMEMENT SEUL

C'est la question qui fait la différence entre un apparieur et un générateur de bruit. La réponse n'est **pas** une liste écrite à la main classe par classe : c'est une **statistique interne au dépôt**.

Pour chaque classe d'élément, on mesure le **taux de gémellité** : la part de ses membres qui ont au moins un jumeau **dans ce produit-là**. Puis :

> Un élément seul n'est un signal que si, dans ce dépôt, les éléments de sa classe en ont normalement un.
> Seuil : **70 % de gémellité**.

Mesuré sur projet client A (`experiences.mjs`) :

```
1 649 éléments sans aucun jumeau (26,4 %)
   1 064  « seul, et c'est normal »
     585  « seul, et ça ne devrait pas »

Classes AU-DESSUS de 70 % — la solitude y est un SIGNAL
  100 % route.definie · 99 % appel · 94 % operation.suppression · 93 % operation.ecriture
   91 % arg.appel · 90 % champ.schema · 90 % champ.ecrit · 87 % arg.fonction
   86 % champ.projection · 85 % champ.affiche · 82 % litteral.vocabulaire
   81 % route.appelee · 80 % fonction.serveur

Classes EN DESSOUS — la solitude y est le RÉGIME NORMAL
   65 % navigation · 57 % valeur.endur · 40 % fonction.interne · 35 % table
   + liste négative : libelle.ui (32 %), action.ui (58 %), composant (63 %),
     index (78 %), ecran (88 %), stockage.local (100 %)
```

Le mécanisme s'auto-calibre : sur un produit où les libellés sont systématiquement liés à des champs, `libelle.ui` remonterait au-dessus de 70 % et sa solitude redeviendrait un signal, sans qu'on touche une ligne. C'est le même principe que le blocage sur jetons trop fréquents : **ce qui est partout ne discrimine rien**.

Deux garde-fous s'ajoutent au taux : la liste négative par défaut (six classes où la solitude ne signifie jamais rien, quoi qu'en dise la statistique), et le fait que la solitude **ne produit pas de constat directement** — elle alimente un rapport séparé (`--solitudes`), consultable, jamais mélangé aux désaccords. Les 585 solitudes anormales d'projet client A sont un **inventaire à trier**, pas 585 bugs, et elles ne polluent pas les 14 constats.

---

## 4. LA MESURE

### 4.1 Sur le banc de 20 défauts (avant sa perte)

Sortie de `mesurer.mjs`, qui confronte chaque constat à la vérité terrain en exigeant **le bon motif ET le bon endroit** :

```
  défauts plantés            20
  défauts détectés           20  (100 %)
  constats émis              23
  constats rattachés         22
  constats non rattachés      1
  justesse brute             96 %

  NON RATTACHÉ (jugé à la main) :
    convex/stats.ts:50  « caMois » n'agrège que les 500 lignes ramenées
    → vrai défaut du même type que le #18, simplement non planté par l'auteur du banc.

  # 1 ✓ contrat producteur/consommateur      # 11 ✓ écriture non attendue
  # 2 ✓ action qui ment                      # 12 ✓ panne déguisée en donnée
  # 3 ✓ tâche planifiée sans son nom         # 13 ✓ deux grandeurs sous un nom
  # 4 ✓ garde contournable                   # 14 ✓ vérification qui s'efface
  # 5 ✓ chiffre inventé                      # 15 ✓ réglage qui ne règle rien
  # 6 ✓ total ≠ somme du détail              # 16 ✓ définition métier dédoublée
  # 7 ✓ filtre de locataire oublié           # 17 ✓ cible inexistante
  # 8 ✓ chiffre cliquable sans décompte      # 18 ✓ agrégat sur échantillon
  # 9 ✓ idempotence factice                  # 19 ✓ ordre implicite faux
  #10 ✓ vocabulaire divergent                # 20 ✓ suppression sans cascade
```

**1/20 → 20/20 détectés. 54 % → 96 % de justesse.**

Un point de méthode que je ne cache pas : le banc a servi à la **mise au point**. Ce 20/20 est un chiffre d'entraînement, pas d'aveugle. La validation hors échantillon, c'est projet client A et projet client B, ci-dessous.

### 4.2 Sur projet client A (hors échantillon, vérification manuelle intégrale)

Le chemin, parce que c'est lui qui prouve la méthode :

| passe | constats | ce qui a été trouvé en vérifiant la source |
|---|---|---|
| 1 | 123 | 27 champs « jamais écrits » qui l'étaient par un `insert(..., {...b})` à spread irrésolu ; projections construites par `map.set()` invisibles |
| 2 | 36 | 13 faux positifs vérifiés à la main : boutons `onClick={save}`, props déléguées, gestes d'interface, prédicats de toute la fonction au lieu de ceux de la valeur |
| 3 | 16 | 2 jugements restants (route de test interne sans secret) |
| **4 (final)** | **14** | **14 vrais sur 14, vérifiés un par un dans la source** |

Chacune des 22 corrections est devenue une ligne de liste négative ou une abstention dans le code, pas un cas particulier.

Les 3 constats `population` d'projet client A méritent d'être cités, parce que c'est exactement le type de défaut « auquel personne n'a pensé » :
- `agenda.compteurs.enRetard` compte `échéance < aujourd'hui **OU** urgence === "Urgent"` ; `taches.cockpit.enRetard` compte seulement `échéance < aujourd'hui`. Le code d'projet client A **commente lui-même le risque** : « Le chiffre du bouton et le contenu de la liste doivent compter la même chose, sinon on clique sur « 6 » et on en voit huit. » L'apparieur l'a trouvé sans savoir lire ce commentaire.
- `crmBiens.compteurs.actifs` = `archive !== true` ; `vueEnsemble.kpis.biensActifs` = `statut !== "Estimation"`. Deux définitions de « bien actif », deux tables, deux KPI affichés côte à côte.

### 4.3 Sur projet client B et banc2

- **projet client B** : 17 382 éléments, **43 constats**, 6,2 s. Dont 8 « secours qui renvoie la forme du succès » sur des routes `/api/*` (panne Google Calendar indiscernable d'un agenda vide), 13 « affiché mais non produit », 13 « suppression sans cascade ».
- **banc2** : 464 éléments, **2 constats** (`+41 22 501 40 12` en dur sous un libellé `telephone` qui a un jumeau `proprietaires.telephone` ; `visites.rappelVisitesDemain` qui calcule `debutDemain` et n'en fait rien). Pas de vérité terrain, mais §5 dit ce qu'il y rate.

---

## 5. OÙ LA MACHINE S'ARRÊTE, ET CE QUE ÇA NE RÉSOUT PAS

### 5.1 La frontière, mesurée

Trois mesures la situent :

1. **La solitude est calculable, l'intention ne l'est pas.** 1 064 des 1 649 solitudes d'projet client A sont classées automatiquement « normal » par le taux de gémellité. Les 585 restantes sont un inventaire qu'aucun calcul ne tranche : il faut savoir si le produit *voulait* que ce champ ait un jumeau. La machine livre la liste, pas le verdict.
2. **Le désaccord est calculable, sa légitimité ne l'est pas.** Sur projet client A, passer de 36 à 14 constats a demandé **13 renversements manuels**. Chacun portait sur la même question : *ce désaccord est-il voulu ?* Un bouton « Copier » qui n'écrit rien est voulu. Un bouton « Enregistrer » qui n'écrit rien ne l'est pas. Aucune mesure ne sépare les deux : c'est une liste de verbes, c'est-à-dire de la connaissance du domaine. **Elle est petite et finie** (2 regex de 20 mots dans `apparier.mjs`), et c'est là toute la nouvelle : le catalogue résiduel ne porte plus sur les bugs (infini), il porte sur les gestes d'interface (fini).
3. **La part floue est minoritaire et c'est tant mieux.** 3 constats sur 23 reposent sur une similarité ; 6 sur la normalisation ; les 14 autres sur des égalités de clé normalisée, donc sur de la preuve. Là où l'apparieur devine, il le dit : le champ `confiance` = jumelage × force, et `--min 0.75` ne garde que le sûr (10 des 14 constats projet client A).

**Là où il faut un agent qui comprend l'intention**, et pas un calcul :
- décider si `agenda.enRetard` **doit** inclure les urgents (le désaccord est certain, la bonne définition est un choix produit) ;
- décider si une suppression **doit** cascader (dans `migration.ts`, l'absence de cascade est peut-être voulue) ;
- lire un commentaire, un ticket, une conversation, pour savoir laquelle des deux définitions est la vraie ;
- nommer le champ manquant quand la réparation en exige un.

### 5.2 Ce que ça ne résout pas

- **Deux valeurs d'un même producteur.** Le contrôle « même écran » saute les paires dont la source est la même fonction. Sur banc2, `tableauBord.indicateurs` renvoie `visitesSemaine` (7 jours) et `variationVisites` (mois sur mois) dans le même objet : l'apparieur ne les compare pas. **Angle mort assumé et localisé.**
- **Les ratios dont le dénominateur exclut le numérateur.** Toujours banc2 : `tauxTransformation = offresAcceptees / offresEnCours` où `offresEnCours` ne compte que `statut === "recue"`. Deux populations sous un même ratio. Non détecté.
- **L'arithmétique.** Division par zéro, débordement, arrondi : ce n'est pas un désaccord entre jumeaux, c'est une propriété d'une expression. Hors champ.
- **Le temps d'exécution et le runtime.** L'apparieur ne lance rien. Une donnée réellement absente en base, une variable d'environnement manquante en production, un index non déployé : invisibles. Complémentaire de la preuve par donnée témoin du skill maison, pas substituable.
- **Les stacks non instrumentées.** Extracteurs écrits pour Next.js App Router + Convex. Prisma, Drizzle, tRPC, Supabase demandent chacun un visiteur (environ 80 lignes sur le modèle de `visiterSchema`). Le reste (lexique, appariement, sept attributs, liste négative) est indépendant de la stack.
- **Le multi-dépôt.** Un écran dans un dépôt et son API dans un autre : les jumeaux ne se rencontrent jamais.
- **Le rappel réel est inconnu.** On sait que l'apparieur trouve 20/20 sur un banc conçu pour les défauts de câblage. On ne sait pas combien de vrais défauts d'projet client A restent invisibles : il n'existe pas de vérité terrain sur un produit réel. Les 14 constats sont un plancher, jamais un plafond, et ce dossier ne prétendra pas le contraire.

---

## 6. PROTOCOLE DE BOUT EN BOUT

**Qui tourne quand.**
- À chaque `git push`, en CI : `node apparieur.mjs . --json rapport.json --min 0.75`. 2 s sur projet client A, 6 s sur projet client B : ça tient dans un hook `pre-push` sans qu'on le sente. La CI échoue si un constat **nouveau** apparaît, jamais sur le stock existant (on compare au `rapport.json` de la branche de base).
- À l'ouverture d'un chantier sur un module : `--solitudes` pour l'inventaire des éléments qui devraient avoir un jumeau et n'en ont pas.
- Après chaque écran livré : l'apparieur AVANT de dire « fait ». Le cas Sophie Martin se serait vu à la première exécution.

**Qui juge.** Le calcul classe, il ne tranche pas. Trois bacs, par confiance :
- `≥ 0,80` : **désaccord établi**. On corrige ou on justifie, on ne discute pas l'existence du désaccord.
- `0,60 – 0,80` : **désaccord à arbitrer**. Un agent lit les deux jumeaux et dit laquelle des deux définitions est la bonne. Il ne décide jamais qu'il n'y a pas de désaccord.
- `< 0,60` : **inventaire**, hors rapport principal.

**Comment on empêche un agent de faire taire un désaccord au lieu de le résoudre.** C'est le vrai risque : la façon la moins chère de faire disparaître un constat est d'élargir une liste négative. Trois verrous :
1. **La liste négative est du code versionné**, pas une base de suppressions. Toute modification de `LISTE_NEGATIVE` apparaît dans le diff, au même titre qu'une correction. Un agent qui l'élargit le fait au su de tout le monde.
2. **Chaque entrée de liste négative doit citer sa mesure.** Les onze entrées actuelles portent chacune un chiffre en commentaire (« 7 faux positifs retirés d'projet client A », « 86 constats sur 162 disparaissent sur projet client B »). Une entrée sans mesure est refusée en revue.
3. **La fermeture d'un constat exige un jumeau, pas un silence.** Un désaccord se résout de trois façons seulement : on rend les jumeaux d'accord (on corrige) ; on supprime le jumeau orphelin (on retire le champ mort) ; ou on **déclare l'écart** en nommant les deux définitions différemment (`enRetardStrict` / `enRetardOuUrgent`) — auquel cas ils cessent d'être jumeaux et le constat disparaît *par le code*, pas par la configuration. Ajouter une exception nominative pour un fichier précis n'est pas une résolution.

**Ce qui rend ce protocole tenable** : le rapport est court. 14 constats sur un produit de 7 000 éléments se lisent en cinq minutes. C'est la condition pour que quelqu'un les lise vraiment, et c'est pour ça que la liste négative et l'abstention comptent autant que la détection.

---

## 7. LE DIALOGUE APPRIS À COMPARER (2026-09-11)

Point de départ mesuré : `mesure/mesurer.mjs --fige` avec l'adaptateur du dialogue,
sur les 26 défauts connus de `banc/fige`.

| | bon fichier | bonne ligne | bon diagnostic | signalements vrais |
|---|---|---|---|---|
| scanner seul | 25/26 | 23/26 | 9/26 | 77/84 |
| dialogue, avant | 26/26 | 24/26 | **10/26** | 72/79 |
| dialogue, après | 26/26 | **26/26** | **22/26** | 88/95 |

Familles à zéro : 9 → **2** (GARDE_EFFACEE, CONTRAT).
Familles qu'aucune règle ne prétend couvrir : 5 → **0**.

### 7.1 Deux corrections de structure, avant toute règle

1. **L'apparieur n'avait pas de voix.** Tout ce qu'il disait ressortait sous
   l'identifiant de règle du scanner : aucune mesure ne pouvait lui attribuer un
   diagnostic. Chaque désaccord porte maintenant un `regleApp` (X1…X15), déclaré
   dans `mesure/familles.mjs` à partir du titre que la règle se donne. Le
   signalement du scanner reste, intact, sous son propre identifiant.
2. **La règle cardinale était contournée par une porte de derrière.** Quand deux
   endroits désignés par le scanner tombaient sur le même désaccord, `dialogue.mjs`
   jetait le second (`continue`). Mesuré : un défaut perdu en ajoutant une règle sans
   rapport. Le second endroit reste désormais, seule la voix de l'apparieur ne se
   répète pas.

### 7.2 Les quinze règles, et ce que chacune refuse de dire

Chaque règle porte sa LISTE NÉGATIVE **écrite avant elle**, dans le code, avec la
mesure qui la justifie quand il y en a une.

| id | attribut | ce qu'elle dit | famille |
|---|---|---|---|
| X1 | garde | N des M mutations du module vérifient qui appelle, pas celle-ci | PORTE_PARALLELE |
| X2 | existence | l'argument accepté que le corps ne lit jamais | ACTION_MUETTE |
| X3 | unité | un côté de la recherche n'est pas à la même graduation que l'autre | RECHERCHE_MUETTE |
| X4 | source | le repli en dur qui a la forme de la vraie donnée serveur | CHIFFRE_INVENTE |
| X5 | population | le décompte affiché et le détail du même écran ne comptent pas pareil | DRILLDOWN |
| X6 | existence | une table écrite depuis plusieurs endroits et lue par aucun | CODE_MORT |
| X7 | formule | le catch qui avale la panne et répond quand même succès | PANNE_DEGUISEE |
| X8 | population | une moyenne dont la somme et l'effectif ne couvrent pas le même ensemble | CHIFFRE_INVENTE |
| X9 | unité | une somme de montants qui ne regarde pas la devise voisine au schéma | UNITE_DIVERGENTE |
| X10 | population | le compteur écarte des lignes que la liste du même module rend | DRILLDOWN |
| X11 | formule | un cas limite (vide, NaN, non fini) affiche un chiffre fabriqué | CHIFFRE_INVENTE |
| X12 | formule | une division non protégée quand une sœur du fichier protège la sienne | CHIFFRE_INVENTE |
| X13 | vocabulaire | une écriture d'état revient en arrière sans lire l'état courant | ETAT_ECRASE |
| X14 | existence | un réglage stocké, exposé, et que rien ne consulte *(existante, enfin nommée)* | REGLAGE_INERTE |
| X15 | formule | le nom désigne le plus récent, la requête ne trie pas *(existante)* | ORDRE_IMPLICITE |

### 7.3 Cinq corrections d'extraction, toutes payées par une mesure

- `const maj = {}` puis `maj.ville = …` : les clés d'un objet construit par
  affectations successives sont désormais lues. Sans ça, `ctx.db.patch(id, maj)`
  restait « opaque » et l'apparieur s'abstenait sur une forme dont il avait toutes
  les clés. (+1 défaut, +1 niveau de précision.)
- `ctx.db.patch(offre.bienId, …)` touche la table que `bienId` désigne, pas celle
  de `offre`. La clé étrangère le dit ; elle est lue.
- Les arguments pris **en bloc** (`{ id, ...fields }`, `Object.entries(args)`) :
  abstention. Mesuré : **30 faux positifs sur projet client B** avant.
- Les divisions sont relevées à l'**AST**, plus au texte : au texte,
  `https://api/v2/files` et le littéral `/g` sont des divisions. Mesuré :
  **23 fausses alertes sur projet client A**, 0 après.
- Une garde de dénominateur n'est pas « il est testé quelque part » mais une forme
  qui exclut le zéro (`> 0`, `<= 0 → return`, `?`, `&&`, `|| 1`, `Math.max`), lue
  sur tous les niveaux de fonction englobants. Mesuré : 3 faux positifs de plus
  retirés sur projet client B.

### 7.4 Ce que §5.2 déclarait insoluble et qui ne l'est plus

- « Les ratios dont le dénominateur exclut le numérateur » : X8 traite le cas des
  **moyennes** (somme ÷ effectif doivent couvrir le même ensemble). Les **taux**
  restent volontairement hors champ : un taux a le droit d'avoir deux populations.
- « L'arithmétique » : toujours hors champ **seule**. X12 ne parle que quand une
  sœur du même fichier protège la sienne : c'est le jumeau qui fait le défaut.

### 7.5 Ce qui reste hors de portée, et pourquoi

- **GARDE_EFFACEE** sur un webhook unique : la règle des portes sœurs (X1) a besoin
  d'au moins deux portes. Un dépôt qui n'a qu'une route publique n'offre aucun
  jumeau à qui la comparer. Non exprimable par appariement.
- **CONTRAT** quand le jumeau est une phrase en français (« offres acceptées
  rapportées aux offres reçues ») et non un élément de code. Lire la légende pour
  la confronter à la formule demande autre chose qu'un apparieur.
- Deux écrans montrant le même intitulé exact avec deux populations : exprimable,
  mais c'est DEFINITION_DOUBLE, pas DRILLDOWN. Écrit ici plutôt que forcé là-bas.

# Réparer : le protocole de bout en bout

Le diagnostic existait, la réparation manquait. l'ancien `scripts/reparer.mjs` (retiré du skill) promettait de
réparer et n'écrivait qu'un fichier d'état : il ne modifiait pas une ligne de code.
Ce dossier fait le travail.

La règle du chantier, en une phrase : **le scanner désigne, la frontière trie, le
codemod ou l'agent corrige dans son bail, et un juge qui n'a pas travaillé rend le
verdict sur un invariant que personne ne peut faire taire.**

---

## Les six pièces

| Fichier | Ce qu'il fait |
|---|---|
| `empreintes.mjs` | Donne à chaque défaut une identité stable, insensible aux décalages de lignes. Tout le reste en dépend. |
| `frontiere.mjs` | Tranche règle par règle : codemod déterministe, agent, ou décision humaine. |
| `codemods/*.mjs` | Les corrections mécaniques. Trois secondes, zéro jeton, résultat identique à chaque passage. |
| `invariants.mjs` | La preuve qu'une correction a eu lieu, sans demander au scanner. |
| `diff-garde.mjs` | Refuse un diff qui éteint un détecteur au lieu de corriger. Impose le bail. |
| `boucle.mjs` | Découpe en lots disjoints, ouvre un worktree par lot, rend le verdict. |
| `eprouver-garde.mjs` | Rejoue les triches réelles contre le garde. Un garde non éprouvé ne vaut rien. |

---

## Le cycle

### 0 · Ne jamais travailler dans le projet vivant

```bash
rsync -a --exclude node_modules --exclude .next --exclude .git <projet>/ /tmp/copie/
cd /tmp/copie && git init -q && git add -A && git commit -qm "base"
```

On livre un diff, pas un dépôt modifié. Sur un projet client, c'est le client qui
décide d'appliquer.

### 1 · Identifier (avant toute boucle)

```bash
node reparation/empreintes.mjs <repo>
```

Chaque défaut reçoit un identifiant `RÈGLE:hash(fichier#ancre)`. L'ancre est, par
ordre de préférence : le symbole qualifié (`parametres.enregistrer`), la charge utile
si elle est unique dans le fichier (`«/modules/parametres/etat»`), la charge plus son
rang d'apparition, le symbole englobant, et en tout dernier le numéro de ligne, qui
est alors marqué `stable: false`.

Mesuré sur projet client A : **621 empreintes conservées sur 621 après un décalage de six lignes**
en tête du fichier le plus touché. Sans ça, la première correction renomme tous les
défauts suivants du fichier et la boucle tourne sur elle-même.

⚠️ Les empreintes d'un état se calculent SUR cet état. Calculer les empreintes
d'« avant » en lisant l'arbre déjà corrigé produit de fausses régressions : c'est
l'erreur qui m'a fait voir sept apparitions imaginaires la première fois.

### 2 · Trier

```bash
node reparation/frontiere.mjs <repo>
```

La question, règle par règle : **peut-on écrire la correction sans comprendre
l'intention du code ?** Le coût de l'erreur n'est pas symétrique. Confier du mécanique
à un agent coûte des jetons. Confier à un codemod ce qui demande une intention produit
une correction fausse qui compile, donc invisible. **Dans le doute : agent.**

Sur projet client A : 253 mécaniques (41 %), 365 pour un agent (59 %), 3 pour un humain.

### 3 · Ouvrir un lot

```bash
node reparation/boucle.mjs <repo> preparer
node reparation/boucle.mjs <repo> lots
node reparation/boucle.mjs <repo> ouvrir <nom-du-lot>
```

Le lot reçoit **son propre worktree git**, donc son propre répertoire sur le disque, et
un `bail.json` qui liste les fichiers qu'il a le droit de toucher. Deux lots ouverts en
parallèle ne partagent aucun fichier : c'est la seule façon d'empêcher mécaniquement
deux agents de s'écraser. Une consigne ne l'empêche pas, on l'a mesuré.

L'unité de lot est le FICHIER, pas la règle : on ouvre un fichier une fois et on y
corrige tout.

### 4 · Corriger

**Lot mécanique** — lancer le codemod dans le chantier :

```bash
node reparation/codemods/<codemod>.mjs <chantier>              # à blanc d'abord
node reparation/codemods/<codemod>.mjs <chantier> --appliquer
```

Chaque codemod refuse de traiter ce qui sort de sa condition et le rend à l'agent. Le
codemod `b3-basculer-interne` a failli casser l'ingestion du calendrier d'projet client A parce
qu'il classait `scripts/ingest_icloud_agenda.mjs` du côté serveur : la condition est
maintenant l'inverse d'une liste noire, est serveur ce qui vit dans `convex/`, tout le
reste est un consommateur public.

**Lot agent** — le brief que reçoit l'ouvrier contient, et seulement :
le contrat du défaut (empreinte, constat, correction attendue, invariants), le bail,
et l'interdiction explicite des six triches. Pas le rapport complet du scanner : il y
lirait les 618 autres défauts et sortirait de son bail.

### 5 · Juger

```bash
node reparation/boucle.mjs <repo> juger <nom-du-lot>
```

Le juge est un contexte **frais**. Il reçoit trois choses et rien d'autre : le contrat,
le diff, le résultat des invariants. Il ne voit ni le raisonnement de l'ouvrier (il en
hériterait la conviction), ni le recompte du scanner (l'ouvrier peut le faire taire).

Trois verdicts : `ACCEPTÉ`, `REFUSÉ`, `INJUGEABLE`. Un contrat sans invariant est
`INJUGEABLE` : rien ne peut être prouvé, donc rien n'est accepté.

Dans l'ordre :

1. **Le bail.** Un seul fichier touché hors bail révoque le lot ENTIER. Pas de
   rattrapage partiel : un lot qui a débordé a pu écrire n'importe quoi, on ne sait
   plus ce qui est sûr dedans.
2. **Les six triches** (`diff-garde.mjs`), plus les cinq mouvements du floor-guard
   d'Addy Osmani dont on reprend la plomberie de diff et les codes de sortie.
3. **Les invariants** (`invariants.mjs`), qui ne demandent rien au scanner.

### 6 · Remesurer, et lire le bon chiffre

```bash
node reparation/empreintes.mjs <repo> --diff
```

Le chiffre qui compte n'est pas la baisse du total : c'est **le nombre d'empreintes
apparues**. Une apparition est une correction qui a cassé autre chose. Sur le lot
Paramètres d'projet client A : 19 disparues, **0 apparue**.

---

## Les six triches, et ce qui les refuse

Toutes constatées dans notre propre code, aucune imaginée.

| Triche | Ce qu'elle éteint | Règle du garde |
|---|---|---|
| `// appelé par X` | A1 (`ANNOTATED`, audit-backend ligne 135) | `annotation-qui-eteint` |
| renommer en `old/archive/legacy/backup` | tout le scan (`LEGACY`, ligne 34) | `mise-au-placard` |
| `--only=A,B` au recompte | un axe entier | `axe-masque` |
| `disabled` sur un bouton | D6 | `bouton-eteint` |
| extraire le littéral dans une constante | D5 | `litteral-deplace` |
| fichier vide (`touch scripts/backup.sh`) | D9, I3 | `fichier-alibi` |

Plus : `hors-bail`, `outillage-modifie` (un diff qui touche l'auditeur ne corrige pas
un projet), `verificateur-eteint`, `travail-inacheve`, `test-rendu-facile`,
`assertion-retiree`.

```bash
node reparation/eprouver-garde.mjs     # 12 épreuves : 11 triches refusées, 1 correction honnête acceptée
```

Deux pièges du garde lui-même, tous deux trouvés en le mesurant et pas en le relisant :

- il analysait ses propres rapports (`empreintes.json` cite le code fautif du projet,
  `catch {}` compris) et refusait le lot à cause de ses notes ;
- son contrôle du bouton éteint regardait **tout le fichier**, donc un `fetch(` ajouté
  trente lignes plus haut par une autre correction du même lot servait d'alibi. Le
  voisinage est maintenant compté en lignes du fichier (±6), via les en-têtes `@@`.

---

## ⚠️ Le cas du projet sans fondation d'authentification

Le skill officiel `convex-authz` est formel, et c'est exactement projet client A :

> check the auth foundation exists before injecting any ctx.auth enforcement […] If
> EITHER is missing, DO NOT add requireIdentity/requireOwner — on a foundationless app
> `ctx.auth.getUserIdentity()` always returns null […] and a reviewer correctly flags
> that as a NEW authz defect, not a fix. Instead […] convert the public query/mutation
> to internalQuery/internalMutation.

Sur projet client A : pas de `convex/auth.config.ts`, pas de table clée sur un sujet
d'authentification. Les 219 « portes publiques sans garde » ne se corrigent donc PAS en
ajoutant une garde. Elles se trient :

- 109 qu'aucun consommateur n'appelle → `internal*`, la porte disparaît. Mécanique.
- 109 qu'un écran ou un script appelle → **dette d'authentification, déclarée une fois**,
  pas 109 fois. Ce n'est pas une correction de code, c'est un chantier.
- 2 vrais B3 (`crmDocuments.brut`, `crmEstimations.aGeocoder`), appelées depuis
  `convex/` : bascule mécanique avec réécriture de l'appelant.

```bash
node reparation/codemods/b3-basculer-interne.mjs <repo>              # à blanc
```

---

## Ce qui reste vrai

Le skill prouve que la chaîne est reliée, jamais que la donnée qui y circule est juste.
Un invariant d'exécution (`npx tsc --noEmit`, un test) est plus fort qu'un invariant de
texte ; un parcours réel dans le navigateur serait plus fort encore, et c'est ce qui
manque (`parcours.mjs`, lot 4 du TODO).

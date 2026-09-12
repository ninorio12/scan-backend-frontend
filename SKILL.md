---
name: scan-backend-frontend
description: 'Audit d''un SaaS Convex + Next.js : désaccords écran/donnée expliqués en français, boutons au navigateur, fausses données en base, un seul bilan. Sur Prisma, Drizzle, Supabase et tRPC : tables, écritures, gardes, liens morts, lectures non bornées ; l''accord écran/donnée y est partiel et le dit. À invoquer sur « scan backend », « audite ce SaaS », « teste tous les modules », « qu''est-ce qui est cassé », « ça affiche vide », « enregistré mais rien n''est sauvegardé », « le chiffre est faux ».'
metadata:
  version: 0.1.0
  license: MIT
---

# SCAN BACKEND FRONTEND

## Pourquoi

Sur n'importe quel SaaS : trouver tout ce qui casse le lien entre les modules et la
donnée. Un écran qui affiche une valeur qu'aucune source n'alimente. Un bouton qui annonce
un succès sans rien écrire. Un rendez-vous présent dans cinq modules qui lisent cinq bases.
Des boutons morts, des fausses données de maquette en base, des écrans cassés. On ne
cherche pas des bugs dans un catalogue infini : on cherche des choses qui auraient dû être
d'accord et ne le sont pas, sur sept attributs (existence, source, formule, vocabulaire,
unité, population, garde). Le raisonnement complet : `references/doctrine.md`.

## La commande

Toutes les commandes de ce fichier se lancent **depuis la racine du skill** (le dossier
qui contient `package.json` et `scripts/`) ; seul `<repo>` est un chemin absolu. Le skill
s'installe où on veut : aucune commande ne suppose un emplacement d'installation, et un
script Playwright posé ailleurs ne trouverait pas le navigateur.

```bash
node scripts/couverture.mjs <repo> --url http://localhost:3000 [--export <zip|dossier>]
```

`--export` ne sert que si la base n'est pas Convex : il est transmis tel quel à
`nettoyer-base`, et sans lui la base reste « non regardée » et le bilan ne dit **rien
d'autre** sur elle. Le format (un dossier, un `.jsonl` par table) est dans
`references/outils.md` ; les commandes toutes faites pour SQLite et Postgres sont dans
`references/parcours-reel.md`. Elle enchaîne toute la chaîne (reconnaissance, code, base, écrans, questions, bilan) et
sort en code 2 tant que le travail est incomplet. Trois codes de sortie, pour tous les
scripts : 0 rien à signaler · 1 des défauts trouvés · 2 le travail n'a pas pu être fait,
et le script dit pourquoi. Un code 2 ne se lit jamais comme un 0. Le verdict est dans
`<repo>/.backend/BILAN.md`, tout le reste dans `<repo>/.backend/` (ignoré par git).

## ⛔ La loi : la paresse est interdite

Un audit partiel présenté comme complet est pire qu'aucun audit : il fait croire que ce
qui n'a pas été regardé est propre. Ça ne se règle pas par la bonne volonté, ça se règle
par un mécanisme : tant que `couverture.mjs` sort en code 2 et que la section « TRAVAIL
INCOMPLET » ou le niveau INCONNU du bilan apparaissent, rien n'est terminé et je ne dis à
personne que c'est terminé. Les gestes de paresse, nommés parce qu'ils ont tous été commis :

| Le geste | Ce qu'il coûte |
|---|---|
| `--rapide` ou `--max` sur les clics | on annonce un écran propre en ayant cliqué 16 boutons sur 214 |
| lancer sans que l'application réponde, ou sur une autre application | tout le côté écran devient faux, et le rapport dit « rien à signaler » |
| lire une sortie tronquée (`head`, ou sans `--full`) | on rate la section qui portait le chiffre |
| s'arrêter au premier module qui marche | les quatorze autres ne sont pas « probablement pareils » |
| « je te fais la suite quand tu veux » | il n'y a pas de suite, il y a un travail fini ou pas |
| présenter le résultat d'un agent sans l'avoir remesuré | un agent se trompe, et son chiffre devient le nôtre |
| compter comme « testé » un écran qui n'a rien rendu | un spinner n'a jamais aucun bouton mort |

Ce qui compte comme terminé : modules testés = modules trouvés ; boutons cliqués =
boutons recensés, moins ce qui écrit, écarté nommément ; pages à identifiant testées
avec un identifiant réel ; et pour chaque chose non faite, une ligne qui dit laquelle et
pourquoi. Le silence n'est jamais un résultat.

## Les cinq étapes

On me donne un chemin de dépôt. Je déroule ces étapes sans rien demander, et je ne pose
une question que si une décision est irréversible.

`couverture.mjs` **enchaîne lui-même les étapes 1, 2, 3 mécanique et 4** : on ne lance pas
les deux. Les commandes détaillées ci-dessous servent à rejouer une étape seule (elle a
échoué, on veut le détail, on a fourni un export de base entre-temps). Les étapes 3 agents
et 5, elles, ne sont dans aucun script : elles sont à ma charge. Toutes les commandes se
lancent depuis la racine du skill.

### 1 · Je regarde

```bash
node scripts/reconnaitre.mjs <repo>          # stack, pages, modules, schéma, dev ou prod, application
```

Il dit ce qu'il a compris et ce qu'il n'a pas compris. Trois cas qui arrêtent le côté
écran, et qu'il nomme : l'application ne répond pas (la lancer avec la commande de dev du
projet, sur un port libre) ; une application répond mais rien ne prouve que c'est ce projet
(ne jamais cliquer dedans : lancer le bon projet, puis `--url`) ; l'application renvoie un
écran de connexion ou une redirection d'authentification (renseigner les clés dans
`.env.local`, ou enregistrer une session Playwright et la passer aux scripts d'écran). Si
le déploiement est de production, je ne clique rien et je le dis.

### 2 · Je lis le code et la base

```bash
node scripts/scan.mjs <repo>                 # le scanner désigne, l'apparieur juge, le rapport classe
node scripts/lexical.mjs <repo>              # un concept, une source, un propriétaire (lexique métier)
node scripts/fausses-donnees.mjs <repo>      # ce que les semeurs ont écrit, ce qui est affiché en dur
node scripts/nettoyer-base.mjs <repo>        # les mêmes valeurs dans la base réelle (export hors dépôt)
```

L'apparieur n'a pas le droit de supprimer un signalement, seulement de le classer : le
silence d'un juge n'est pas un acquittement. Ce qu'il comprend monte en tête avec les deux
bouts du désaccord ; le reste descend, groupé par cause, et ne disparaît jamais.
`nettoyer-base` liste des identifiants, il ne supprime jamais : la suppression se décide
devant la liste, avec un humain.

### 3 · J'entre dans la maison

`couverture.mjs` lance un travailleur par écran (processus, navigateur et décompte
séparés) : `liens.mjs`, `clics.mjs` (tous les boutons, sauf ce qui écrit : `type=submit`,
tout bouton dans un `<form>`, les verbes d'écriture, comptés « écartés » nommément) et
`apparence.mjs` (invariants de mise en page en 1440 et 390 px). Un écran qui n'a rien
rendu est « non testé », jamais « 0 bouton mort ».

Puis les agents prennent le relais sur ce qui demande de comprendre : un bouton qui annonce
« Enregistré » sans écrire, un compteur qui ne tombe pas juste, une valeur qui survit à la
coupure de la source. **C'est l'étape qui rapporte le plus** : le 12/09/2026, six agents
ont trouvé les dix défauts les plus graves d'un produit, dont aucun n'était visible
mécaniquement. La procédure complète est exécutable dans `references/parcours-reel.md` :
découpage, brief à recopier, format de rendu, conduite à tenir.

```bash
# 1. j'écris le découpage AVANT de lancer : qui fait quoi, sur quels écrans
#    <repo>/.backend/parcours/groupes.json
# 2. je lance TROIS agents à la fois (six sur un serveur de dev l'ont fait redémarrer)
# 3. chaque agent dépose <repo>/.backend/parcours/<groupe>.json
node scripts/parcours.mjs <repo> --verifier --base http://localhost:3000 --attente 15000
```

Un agent par groupe de trois modules, périmètres disjoints, **trois agents en parallèle**
(six au maximum absolu, et jamais six sur un serveur de développement : mesuré à 7,9 de
charge sur 4 cœurs, 27 s par page, redémarrage du serveur sous la charge). Chaque agent
rend son décompte dans le format imposé : recensés, cliqués, écartés, non testés, non
concluants. Trois interdits sans exception : ne modifier aucun fichier, ne cliquer sur
rien qui écrit ou détruit, **ne laisser aucun guetteur derrière soi**. Un rapport sans
décompte n'est pas fini, on relance ; un groupe qui ne rend pas sort **nommément** en
« non regardé », avec ses écrans, et le bilan reste INCONNU.

Ce que les agents rapportent **passe par le vérificateur** (`verifier-affirmation.mjs`,
sans LLM) avant d'entrer au bilan : confirmé entre, infirmé n'entre pas, invérifiable
entre avec la mention, et un constat sans affirmation entre en « rapporté, non vérifié ».
Dans l'autre sens, un démenti ne retire un constat mécanique que **rejoué et vérifié** :
une mesure ne se retire pas sur parole. Rejoué sur les données de l'épreuve : 28 constats
d'agents entrent au bilan (dont les dix plus graves du produit, qui n'y étaient pas), et
189 faux « boutons morts » sur 256 en sortent (`banc/audit/chantier-canal.md`).

### 4 · Je consolide et je rends le bilan

```bash
node scripts/decisions.mjs <repo>            # les questions de source de vérité, pour l'humain
node scripts/bilan.mjs <repo>                # le verdict, sur l'échelle unique
```

Une seule échelle, par gravité pour le client, jamais par quantité : TROMPE (le client voit
quelque chose de faux : donnée en dur, chiffre faux, succès annoncé sans écriture, côté
écran comme côté code) · CASSÉ (bouton mort, lien mort, page vide, écran illisible, porte
sans garde) · DETTE (rien de visible aujourd'hui, du temps perdu demain) · NON REGARDÉ (ce
qui n'a pas pu être vérifié, et pourquoi). Tant que « non regardé » n'est pas vide, le
niveau est INCONNU. Je remonte la cause racine avant les symptômes, je retire les doublons
entre agents, je liste nommément les données de test en base et je demande avant de retirer.

### 5 · Je répare, sur copie

`reparation/PROTOCOLE.md` : empreintes stables, frontière mécanique/agent, codemods à
blanc d'abord, bail par lot, juge distinct de l'ouvrier. Je travaille sur une copie ou un
worktree et je livre un diff ; l'humain décide de l'appliquer. Une correction ne se croit
pas, elle se remesure : je relance la chaîne et le compteur baisse, ou la correction n'en
était pas une. Un défaut trouvé sur le terrain que le scan n'avait pas vu entre au banc
du skill (`banc/mesure/enrichir.mjs`), qui mesure le skill, pas le projet.

### Ce que je dis à la fin, et rien de plus

Cinq lignes : le niveau du bilan, le nombre de vrais problèmes, la cause racine s'il y en
a une, le plus grave pour le client, ce qui reste non regardé ou à décider. Le détail est
dans `BILAN.md`, pas dans le message.

## Le lexique métier

Le vocabulaire du produit ne vit jamais dans le skill. Il se pose dans
`<repo>/.backend/lexique.json` (modèle : `references/lexique-metier-exemple.json`) : chaque
ligne dit « ce mot désigne ce concept », et deux mots qui pointent le même concept doivent
lire la même source. `lexical.mjs` et `decisions.mjs` le lisent ; une question tranchée
par l'humain devient une règle vérifiée à chaque passage (`decisions.mjs --verifier`).

## Ce que le skill ne fait pas

Il ne prouve pas qu'une donnée est juste, seulement que la chaîne est reliée : la preuve
par témoin (`references/preuve-par-temoin.md`) et le smoke test en prod restent à faire.
Il ne supprime rien en base, ne modifie aucun fichier du projet audité, ne clique sur rien
qui écrit. Il ne fait ni audit de sécurité complet ni de scalabilité (`ultra-audit`), ni
la boucle de déploiement (`dev-builder`). Il ne remplace pas la lecture : le rappel de
l'analyse statique seule se mesure (`node banc/mesure/mesurer.mjs --fige`), il ne se cite
pas, et c'est le côté écran qui rapporte le plus.

## Fichiers

- `references/outils.md` : chaque script, une ligne, sa syntaxe, ce qu'il écrit.
- `references/la-liste.md` : les 77 points vérifiés, avec leur détecteur ou leur ⏳.
- `references/doctrine.md` : la loi centrale, un écran naît branché, les 7 maillons,
  l'échelle de gravité, les deux modes, le mécanisme d'exception.
- `references/lois-backend.md`, `references/contrat-cablage.md` : les 12 lois et le template des 7 maillons.
- `references/parcours-reel.md` : la procédure exécutable de l'étape des agents — combien
  en parallèle, comment découper, le brief à recopier, le format de rendu qui entre dans
  le bilan, quoi faire d'un groupe qui ne rend pas, et l'export d'une base non Convex.
- `references/histoire-des-mesures.md` : ce qui a été chiffré, anonymisé, et ce qu'on en a tiré.
- `references/bloc-claude-md.md`, `modeles/regles/` : ce qui se colle dans le projet audité.
- `references/ajouter-une-stack.md`, `references/gates-qui-tiennent.md`,
  `references/preuve-par-temoin.md`, `references/ce-que-dit-le-terrain.md`,
  `references/ce-qui-marche-vraiment.md`, `references/ce-que-le-vrai-dev-en-dit.md`.
- `banc/mesure/` + `banc/fige/` : le banc qui mesure le skill. `fixtures/repo-piege/` +
  `scripts/test-detecteurs.mjs` : le test des détecteurs. `README.md` : installation.

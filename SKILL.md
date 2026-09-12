---
name: scan-backend-frontend
description: 'Audit d''un SaaS Convex + Next.js : désaccords écran/donnée expliqués en français, boutons au navigateur, fausses données en base, un seul bilan. Sur Prisma, Drizzle, Supabase et tRPC : tables, écritures, gardes, liens morts, lectures non bornées ; l''accord écran/donnée y est partiel et le dit. À invoquer sur « scan backend », « audite ce SaaS », « teste tous les modules », « qu''est-ce qui est cassé », « ça affiche vide », « enregistré mais rien n''est sauvegardé », « le chiffre est faux ».'
metadata:
  version: 0.1.0
  license: MIT
---

# SCAN BACKEND FRONTEND

Sur un SaaS : trouver tout ce qui casse le lien entre les écrans et la donnée. Un écran qu'aucune
source n'alimente, un « Enregistré » sans écriture, un chiffre faux, des fausses données de maquette
en base, des boutons et des liens morts. Un seul bilan, une seule échelle de gravité. Pourquoi ces
défauts-là et pas d'autres : `references/doctrine.md`.

## La commande
Tout se lance **depuis la racine du skill** (le dossier qui contient `package.json`) ; seul `<repo>`
est un chemin absolu.
```bash
node scripts/couverture.mjs <repo> --url http://localhost:3000 [--export <zip|dossier>]
```
Elle enchaîne les étapes 1, 2, 3 mécanique et 4 : on ne lance pas les deux. Verdict dans
`<repo>/.backend/BILAN.md`, le reste dans `<repo>/.backend/` (ignoré par git). `--export` ne sert que
si la base n'est pas Convex ; sans lui la base reste « non regardée » et le bilan ne dit **rien
d'autre** sur elle (format attendu et exports tout faits : `references/outils.md`).

## Les cinq étapes
Ces commandes rejouent une étape seule. Les étapes 3 agents et 5 ne sont dans aucun script : elles
sont à ma charge. Je déroule sans rien demander, et ne pose une question que si c'est irréversible.

### 1 · Je regarde
```bash
node scripts/reconnaitre.mjs <repo> --url http://localhost:3000   # → reconnaissance.json
```
Stack, pages, modules, schéma, dev ou prod, et si l'application qui répond est bien CE projet. Trois
cas qu'il nomme arrêtent le côté écran, chacun avec sa parade dans `references/outils.md`. Sur un
déploiement de production, je ne clique rien et je le dis.

### 2 · Je lis le code et la base
```bash
node scripts/scan.mjs <repo>              # → dialogue.json : le scanner désigne, l'apparieur juge sur 7 attributs
node scripts/lexical.mjs <repo>           # → lexical.json : un concept, une source, un propriétaire
node scripts/fausses-donnees.mjs <repo>   # → fausses.json : ce que les semeurs ont semé, ce qui est affiché en dur
node scripts/nettoyer-base.mjs <repo>     # → fausses-en-base.json : les mêmes valeurs dans la base réelle
```
L'apparieur classe, il ne supprime jamais un signalement. `nettoyer-base` liste des identifiants et
ne supprime rien : la suppression se décide devant la liste, avec un humain.

### 3 · J'entre dans la maison
```bash
node scripts/liens.mjs <url>       # → liens.json : liens internes morts, pages vides
node scripts/clics.mjs <url>       # → clics_<page>.json : tous les boutons, sauf ce qui écrit, écarté nommément
node scripts/apparence.mjs <url>   # → apparence_<page>.json : mise en page en 1440 et 390 px
```
`couverture.mjs` lance ces trois-là, un travailleur par écran ; un écran qui n'a rien rendu est « non
testé », jamais « 0 bouton mort ». Puis les agents prennent le relais sur ce qui demande de comprendre
(un bouton qui ment, un compteur qui ne tombe pas juste, une valeur qui survit à la coupure de la
source) : **c'est l'étape qui rapporte le plus**, tout est dans `references/parcours-reel.md`.
```bash
# 1. le découpage AVANT de lancer : <repo>/.backend/parcours/groupes.json
# 2. TROIS agents en parallèle (six au maximum absolu, jamais six sur un serveur de dev)
# 3. chaque agent dépose son rapport : <repo>/.backend/parcours/<groupe>.json
node scripts/parcours.mjs <repo>                                          # → la forme et les manques
node scripts/parcours.mjs <repo> --verifier --base <url> --attente 15000  # → <groupe>.verifie.json
```
Un agent par groupe de trois modules, périmètres disjoints, décompte obligatoire. Trois interdits
sans exception : ne modifier aucun fichier, ne cliquer sur rien qui écrit ou détruit, ne laisser
aucun guetteur derrière soi. Ce qu'un agent rapporte passe par `verifier-affirmation.mjs` avant
d'entrer au bilan, et un démenti ne retire un constat mécanique que rejoué et tenu : une mesure ne se
retire pas sur parole (`references/affirmations.md`). Un groupe qui ne rend pas sort **nommément** en
« non regardé », et le bilan reste INCONNU.

### 4 · Je consolide et je rends le bilan
```bash
node scripts/decisions.mjs <repo>   # → questions.json : les sources de vérité à trancher par l'humain
node scripts/bilan.mjs <repo>       # → BILAN.md : le verdict, sur l'échelle unique
```
Une seule échelle, par gravité pour le client, jamais par quantité : TROMPE · CASSÉ · DETTE · NON
REGARDÉ ; tant que « non regardé » n'est pas vide, le niveau est INCONNU. Je remonte la cause racine
avant les symptômes, je retire les doublons entre agents, je liste nommément les données de test en
base et je demande avant de retirer. Ce que je dis à la fin, et rien de plus : le niveau, le nombre de
vrais problèmes, la cause racine s'il y en a une, le plus grave pour le client, ce qui reste à décider.

### 5 · Je répare, sur copie
`reparation/PROTOCOLE.md` : empreintes stables, frontière mécanique/agent, codemods à blanc d'abord,
bail par lot, juge distinct de l'ouvrier. Je livre un diff sur copie ou worktree, l'humain décide. Une
correction ne se croit pas, elle se remesure : je relance la chaîne et le compteur baisse, ou la
correction n'en était pas une. Un défaut du terrain que le scan n'avait pas vu entre au banc
(`node banc/mesure/enrichir.mjs`).

## ⛔ La loi : la paresse est interdite
Un audit partiel présenté comme complet est pire qu'aucun audit : il fait croire que ce qui n'a pas
été regardé est propre. Tant que `couverture.mjs` sort en code 2, ou que « TRAVAIL INCOMPLET » ou le
niveau INCONNU apparaissent au bilan, rien n'est terminé et je ne dis à personne que c'est terminé.
Les gestes de paresse, nommés parce qu'ils ont tous été commis :

| Le geste | Ce qu'il coûte |
|---|---|
| `--rapide`, ou un `--max` abaissé sur les clics | on annonce un écran propre en ayant cliqué 16 boutons sur 214 |
| lancer sans que l'application réponde, ou sur une autre application | tout le côté écran devient faux, et le rapport dit « rien à signaler » |
| lire une sortie tronquée (`head`, ou sans `--full`) | on rate la section qui portait le chiffre |
| s'arrêter au premier module qui marche | les quatorze autres ne sont pas « probablement pareils » |
| « je te fais la suite quand tu veux » | il n'y a pas de suite, il y a un travail fini ou pas |
| présenter le résultat d'un agent sans l'avoir remesuré | un agent se trompe, et son chiffre devient le nôtre |
| compter comme « testé » un écran qui n'a rien rendu | un spinner n'a jamais aucun bouton mort |

Ce qui compte comme terminé : modules testés = modules trouvés ; boutons cliqués = boutons recensés,
moins ce qui écrit, écarté nommément ; pages à identifiant testées avec un identifiant réel ; et pour
chaque chose non faite, une ligne qui dit laquelle et pourquoi. Le silence n'est jamais un résultat.

## Les trois codes de sortie
Les mêmes pour tous les scripts : **0** rien à signaler · **1** des défauts trouvés · **2** le travail
n'a pas pu être fait, et le script dit pourquoi. Un code 2 ne se lit jamais comme un 0. Ils sont faits
pour un pre-commit ou une CI.

## Le lexique métier
Le vocabulaire du produit ne vit jamais dans le skill : il se pose dans `<repo>/.backend/lexique.json`
(modèle : `references/lexique-metier-exemple.json`). Chaque ligne dit « ce mot désigne ce concept », et
deux mots qui pointent le même concept doivent lire la même source. `lexical.mjs` et `decisions.mjs` le
lisent ; une question tranchée par l'humain devient une règle vérifiée à chaque passage
(`decisions.mjs --verifier`).

## Ce que le skill ne fait pas
Il ne prouve pas qu'une donnée est juste, seulement que la chaîne est reliée : la preuve par témoin et
le smoke test en prod restent à faire. Il ne supprime rien en base, ne modifie aucun fichier du projet
audité, ne clique sur rien qui écrit. Ni audit de sécurité complet ni scalabilité (`ultra-audit`), ni
boucle de déploiement (`dev-builder`). Le rappel de l'analyse statique seule se mesure
(`node banc/mesure/mesurer.mjs --fige`), il ne se cite pas, et c'est le côté écran qui rapporte le plus.

## Les fiches, dans `references/`
- `doctrine.md` le raisonnement · `histoire-des-mesures.md` les mesures qui ont décidé de chaque règle
- `outils.md` chaque script et ce qu'il écrit, l'export d'une base non Convex, les trois cas d'arrêt
- `parcours-reel.md` l'étape des agents, exécutable · `affirmations.md` ce qu'un agent rend
- `la-liste.md` tout ce qui est vérifié, avec détecteur ou ⏳ · `lois-backend.md` les lois du câblage
- `contrat-cablage.md` les 7 maillons avant de coder · `preuve-par-temoin.md` prouver qu'un écran lit
- `recherche-terrain.md` ce que dit le terrain, y compris contre nous · `gates-qui-tiennent.md` où poser une barrière
- `ajouter-une-stack.md` couvrir une stack inconnue · `bloc-claude-md.md` + `modeles/regles/` à coller dans le projet
- Hors `references/` : `banc/mesure/` + `banc/fige/` le banc qui mesure le skill · `fixtures/repo-piege/`
  + `scripts/test-detecteurs.mjs` le test des détecteurs · `README.md` l'installation

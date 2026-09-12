# La doctrine : pourquoi le skill regarde ce qu'il regarde

Ce fichier porte le raisonnement. La procédure est dans `SKILL.md`, les outils dans
`outils.md`, la liste de contrôle dans `la-liste.md`, l'histoire chiffrée dans
`histoire-des-mesures.md`.

## La loi centrale

Un backend n'est pas une collection de fonctions. C'est un ensemble de chaînes. Une
feature n'existe que si sa chaîne est complète et traversée pour de vrai.

Le vibe coding produit d'excellents maillons et presque jamais de chaînes. Chaque
session écrit une fonction plausible, bien typée, qui compile : et personne ne l'appelle.
Le typage passe, le build passe, la prod est vide. C'est pour ça que « ça compile » n'a
jamais voulu dire « ça marche », et qu'aucun linter ne voit le problème. Mesuré sur trois
SaaS avec l'auditeur de ce skill : entre un tiers et la moitié des unités exposées
n'étaient appelées par rien (chiffres dans `histoire-des-mesures.md`).

## Le renversement : des désaccords, pas des bugs

On ne cherche pas des bugs dans un catalogue infini. On cherche des choses qui auraient
dû être d'accord et ne le sont pas, sur sept attributs : existence, source, formule,
vocabulaire, unité, population, garde. Un seul qui diverge fait le défaut, et la liste
est fermée. C'est le travail de l'apparieur (`scripts/apparier.mjs`), et sa règle absolue,
payée par une mesure : il n'a pas le droit de supprimer un signalement, seulement de le
classer. Une version qui le laissait écarter ce qu'il jugeait sain a fait chuter le rappel
de plus de moitié. Le silence d'un juge n'est pas un acquittement.

## Un écran naît branché

Le défaut le plus coûteux n'est pas une fonction morte, c'est l'écran qui ment : des
champs remplis de valeurs plausibles, un bouton qui affiche « Enregistré » sans rien
écrire. Il passe toutes les relectures, parce qu'il est plus beau qu'un écran réel : ses
données sont choisies. Il ne se révèle que devant le client.

Il a une cause unique : on a dessiné l'écran avant de le brancher, et on a mis des
valeurs pour voir ce que ça donne. Ces valeurs ne partent jamais. D'où la règle qui
supprime la classe entière de bugs :

> On n'écrit jamais une valeur dans une surface. On écrit la lecture d'abord, même vide.

1. La lecture de la source vient en premier, avant le premier pixel. Si la donnée n'existe
   pas encore, la lecture renvoie vide : c'est correct, et c'est l'état vide qu'on dessine.
2. Un champ de formulaire tire toujours sa valeur de la source. Pendant le chargement on
   affiche un squelette, jamais une valeur, parce qu'une valeur d'attente finit par rester.
3. Une action n'annonce jamais un succès qu'elle n'a pas constaté. Le message de
   confirmation arrive après la résolution de la mutation, jamais à la place.
4. Pour juger du rendu avec des données réalistes, on remplit la base, pas le composant.

Trois barrières tiennent cette règle : la règle elle-même à l'écriture ; l'auditeur (axe D)
avant de conclure un tour ; la preuve par témoin avant de livrer (`preuve-par-temoin.md`),
seule capable de voir un champ branché sur la mauvaise source.

## Les 7 maillons

Toute donnée qui compte traverse sept maillons. Un maillon manquant = feature morte, et
la mort est silencieuse.

```
1. DÉCLENCHEUR   qui provoque l'écriture ?  (clic, webhook, cron, agent)
2. CONTRAT       entrées validées + identité de l'appelant vérifiée
3. ÉCRITURE      dans quelle table, avec quelle idempotence ?
4. INDEX         par quel chemin cette donnée sera relue ?
5. LECTURE       quelle requête la ressort, bornée comment ?
6. SURFACE       quel écran l'affiche, et qu'affiche-t-il quand c'est vide ou en panne ?
7. TRACE         où voit-on que ça a marché, et où crie-t-on quand ça casse ?
```

On écrit les 7 maillons avant de coder le premier (`contrat-cablage.md`, dix lignes). Un
maillon qu'on n'arrive pas à nommer est un maillon qui n'existera pas. À la livraison,
dans l'autre sens : une feature n'est finie que quand les 7 maillons ont été traversés en
vrai, en prod, avec la preuve à l'écran. Les 12 lois qui découlent des maillons, avec leur
justification et leurs sources : `lois-backend.md`.

## L'échelle unique de gravité

Quatre niveaux, par gravité pour le client, jamais par quantité (`scripts/bilan.mjs`) :

- TROMPE : le client voit quelque chose de faux (donnée en dur, chiffre faux, succès
  annoncé sans écriture). Côté écran comme côté code : « Enregistré » sans écriture est
  une tromperie, qu'on l'ait vue en cliquant ou en lisant la mutation.
- CASSÉ : ça ne marche pas et ça se voit (bouton mort, lien mort, page vide, écran
  illisible, porte publique sans garde).
- DETTE : rien de visible aujourd'hui, du temps perdu demain.
- NON REGARDÉ : ce que les outils n'ont pas pu vérifier. Tant que cette liste n'est pas
  vide, le niveau est INCONNU.

Deux cents dettes valent moins qu'une tromperie. Un score sur 100 a été essayé et retiré :
il donnait 89/100 à un projet qui comptait des centaines de bloquants, parce que sept axes
sur neuf étaient sains en proportion. Un chiffre que personne ne croit ne sert à rien.

## D'abord l'inventaire, ensuite la liste

Une liste de problèmes connus n'est jamais exhaustive : le 24e type de défaut passera au
travers et l'outil annoncera « zéro défaut » sur un produit cassé. Donc on commence par
l'inverse : on énumère tout ce que le produit contient (`scripts/inventaire.mjs`) et on
exige une preuve pour chaque élément. Trois colonnes : prouvé, non relié, non prouvé. La
troisième est la plus importante : c'est l'aveu d'ignorance qui empêche de conclure trop
vite. Elle se vide en passant dans l'application, jamais en relisant le code.

## Deux modes

MODE CONSTRUIRE (on démarre un SaaS, ou on ajoute un module)

0. Le squelette qui marche, avant tout le reste : une seule tranche verticale complète, du
   clic jusqu'à la table et retour, si maigre soit-elle. Tant qu'elle ne fonctionne pas en
   vrai, on ne construit rien d'autre (`ce-que-le-vrai-dev-en-dit.md`).
1. Écrire le contrat de câblage : les 7 maillons, dix lignes.
2. Construire dans l'ordre imposé : la lecture de la source d'abord, l'écran ensuite.
3. Avant de conclure chaque séance : `node scripts/audit-backend.mjs . --only=A,B,D` à
   zéro bloquant.
4. Avant de livrer : la preuve par témoin sur les écrans touchés, puis le smoke test en
   prod : déclencher, relire la donnée écrite, ouvrir l'écran, puis couper volontairement
   l'intégration (clé invalide) et vérifier que la panne se voit.

MODE RÉPARER (un SaaS existe et personne ne sait ce qui est cassé dedans)

C'est la procédure de `SKILL.md`, puis `reparation/PROTOCOLE.md` : identité stable des
défauts par empreintes, frontière mécanique/agent règle par règle, codemods déterministes,
invariants indépendants du scanner, linter anti-triche et bail imposé, juge distinct de
l'ouvrier. On travaille sur une copie ou un worktree et on livre un diff ; l'humain décide
de l'appliquer. L'ordre des lots n'est pas négociable : les secrets exposés d'abord, puis
les écrans qui mentent au client, puis les portes ouvertes, puis les données orphelines,
et le code mort en dernier parce qu'il ne blesse personne aujourd'hui. On ne croit jamais
une correction, on la remesure : un compteur qui baisse prouve quelque chose, un rapport
qui dit « corrigé » ne prouve rien.

Reprise d'un backend existant : ne jamais commencer par lire le code, commencer par la
mesure (`audit-backend.mjs --json`). Axe A d'abord (chaque unité jamais appelée : la
câbler, l'annoter, ou la supprimer ; jamais « on verra »), puis les tables orphelines,
puis l'axe B en commençant par ce qui touche des données client, puis l'axe C en
commençant par les catch qui masquent une intégration.

## Le mécanisme d'exception

Une unité légitimement appelée de l'extérieur (webhook d'un fournisseur, agent, backfill
one-shot) s'annote dans le code, une ligne au-dessus :

```ts
// appelé par Stripe depuis le dashboard webhooks
export async function POST(req: Request) { … }
```

Elle sort alors du décompte. Sans cette ligne, la session suivante la supprimera ou la
recomptera indéfiniment : l'annotation est le seul moyen de distinguer « pas encore
câblé » de « câblé ailleurs ».

## Le skill seul ne suffit pas

Un skill dont le déclenchement est laissé au modèle n'est pas invoqué dans plus de la
moitié des cas (mesure Vercel, sources dans `bloc-claude-md.md`). Donc : les six règles
non négociables vivent dans le CLAUDE.md du projet (le bloc est prêt dans
`bloc-claude-md.md`), la méthode et les outils vivent dans ce skill, ce qui ne doit jamais
passer vit dans un pre-commit ou une CI (les codes de sortie sont faits pour ça ; le hook
de fin de tour a été essayé et abandonné, voir `gates-qui-tiennent.md`), et le jugement
non contaminé vient d'un agent en contexte frais. Les règles à portée de chemin
(`modeles/regles/`) complètent le CLAUDE.md sans l'alourdir.

## Ce que ce skill ne prouve pas

Qu'une donnée soit juste. Il prouve que la chaîne est reliée, pas ce qu'elle transporte.
D'où la preuve par témoin et le smoke test, qui ne sont pas optionnels. Il ne fait pas
non plus d'audit de sécurité complet ni de scalabilité, ne remplace pas un pilote de
navigateur de bout en bout, et ne supprime jamais rien dans une base : la liste des
documents suspects se décide devant un humain.

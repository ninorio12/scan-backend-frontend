# LA LISTE : tout ce qui est vérifié, sans exception

Quand le skill est invoqué, c'est cette liste entière qui s'applique. Chaque ligne porte
son détecteur (identifiant de règle ou script) ; celles marquées ⏳ sont identifiées,
documentées, pas encore outillées : elles se traitent alors à la main, jamais en les
oubliant. Un agent qui ne peut pas les vérifier le dit dans « non regardé », il ne les
passe pas sous silence.

Le nombre de règles codées se lit dans le code, pas ici : `scripts/audit-backend.mjs
--list-stacks` liste les adaptateurs, et `scripts/rules-*.mjs` portent les règles.
Aucun chiffre de rappel n'est écrit dans cette liste : il se mesure avec
`node banc/mesure/mesurer.mjs --fige`.

## A · L'ÉCRAN : ce que le client voit

1. Un bouton ou un lien qui ne déclenche rien · D6, `clics.mjs`
2. Une action qui annonce « Enregistré » sans rien écrire · D2, apparieur (attribut existence)
3. Un chiffre affiché qui ne vient d'aucun calcul · D7
4. Un champ pré-rempli d'une donnée écrite en dur · D1, `flux.mjs`
5. Un écran entier qui ne lit aucune source · D3
6. Un jeu de données de démonstration resté dans le composant · D4, `fausses-donnees.mjs`
7. Une identité en dur qui pilote une règle métier · D5
8. Deux écrans qui affichent la même donnée différemment · `flux.mjs --divergences`, `lexical.mjs`
9. Une valeur qui survit à la coupure de la source · `coupure.mjs`
10. Un chiffre cliquable qui mène à un écran ne faisant pas ce nombre ⏳ parcours
11. Un paramètre d'URL que la page d'arrivée ne lit pas ⏳ parcours
12. Un écran sans état vide, chargement, panne, 404 ⏳ parcours ; absence de
    `error.tsx` / `loading.tsx` / `not-found.tsx` · D9
13. Une page qui répond 200 sur un identifiant inexistant ⏳ parcours

## B · LE CÂBLAGE : ce qui relie l'écran à la donnée

14. Une fonction ou une route que rien n'appelle · A1
15. Un appel réseau vers une route qui n'existe pas · F1
16. Un lien vers une page qui n'existe pas · F2, `liens.mjs`
17. Une route servie que rien n'appelle · F3, et le rapprochement des deux · F4
18. Une table écrite jamais lue, ou lue jamais écrite · A2
19. Un champ de schéma que personne n'utilise · A3
20. Une tâche planifiée qui vise une cible disparue · A4
21. Une variable d'environnement attendue et non déclarée · A5
22. Un composant jamais monté par aucune page ⏳
23. Une table lue seulement par du code mort ⏳

## C · LES PORTES : accès et contrat d'entrée

24. Une fonction publique sans vérification de l'appelant · B1, via `gardes.mjs` (la garde est
    reconnue par le flux, pas par un nom : ce qui vérifie une identité de session, une
    signature ou un secret comparé, propagé aux appelants par point fixe)
25. Une entrée publique non validée · B2
26. Une fonction interne exposée publiquement · B3
27. Un secret écrit en dur · B4
28. Un fail-open : `if (secret && fourni !== secret)`, garde qui s'évapore si la variable
    d'environnement manque · B5
29. Une identité fournie par l'appelant en argument · G4 ⏳ (la règle existe, elle ne
    ressort pas encore nommément devant les B1 : le cas le plus grave vu sur un projet
    public, `userId: v.string()` en argument sans `ctx.auth`, restait fondu dans la masse)
30. Un identifiant d'objet reçu en argument, lu sans contrôle de propriété (IDOR) ⏳
31. Une fonction qui distribue un privilège sans garde d'administration ⏳
32. Un cloisonnement multi-tenant absent, figé sur une constante, ou choisi par l'appelant ⏳
33. Une garde inerte : fonction de portée qui retourne toujours vrai ⏳
34. Un webhook sans vérification de signature, ou secret passé dans l'URL ⏳
35. Un jeton prévisible servant d'autorisation ⏳
36. Un dépôt de fichier public, une URL de stockage rendue sans contrôle ⏳
37. Un document entier renvoyé alors qu'il contient des champs sensibles ⏳
38. Une erreur ou un journal qui recopie la donnée personnelle ⏳

## D · LE SILENCE : ce qui casse sans bruit

39. Une panne masquée par un `catch` muet · C1
40. Une écriture sans `await` · C2
41. Une lecture non bornée, une collecte non bornée · C3, C6
42. Le temps lu dans une requête réactive · C4
43. Un appel externe sans filet · C5
44. Un webhook rejouable sans idempotence · C7
45. Un index qui ne borne rien (`withIndex` sans clause, ou sur une constante) ⏳
46. Une lecture paginée tronquée : `limit=100` sans curseur ⏳
47. Un appel externe sans échéance maximale, des réessais sans jitter ⏳
48. Une tâche planifiée « au plus une fois » dont l'échec part dans une valeur jetée ⏳
49. Une purge suivie d'une réinsertion, sans transaction ni garde sur le vide ⏳
50. Un upsert qui écrase un état final par un état antérieur ⏳
51. Un tableau qui grossit sans borne dans un document ⏳
52. Une migration en une seule transaction, non reprenable ⏳
53. Une colonne supprimée que le code lit encore ⏳

## E · LES CHIFFRES : ce qui rend un nombre faux

54. Des données de démonstration comptées comme réelles · E6
55. Le même indicateur calculé de deux façons · apparieur (population, formule)
56. Une grille de jours différente selon l'écran (signe de fuseau inversé) · H2
57. De l'argent additionné sans conversion, un taux écrit en dur · E5, apparieur (unité)
58. Un chiffre passé qui change parce que l'état est écrasé sur place ⏳
59. Une déduplication qui ne déduplique pas ⏳
60. Un total qui ne correspond pas à son propre détail · apparieur (population) ⏳ à l'exécution
61. Une division par zéro qui invente 0 ou 100 selon l'endroit · apparieur (formule)
62. Une unité mélangée : centimes et unités, taux en 0-1 et en 0-100 ⏳

## G · L'AUTHENTIFICATION QUI NE GARDE RIEN (règles officielles Convex)

63. Des gardes d'identité sans `convex/auth.config.ts` : elles renvoient toujours null · G1
64. Le client n'envoie pas les jetons (`ConvexProvider` nu) : connecté à l'écran, anonyme au backend · G2
65. Une garde qui s'efface selon une variable d'environnement, surtout publique · G3
66. Une autorisation décidée sur une identité reçue en argument · G4

## H · LES PIÈGES DÉJÀ PAYÉS : nos incidents

67. Une tâche planifiée qui vise une fonction gardée par une identité · E1
68. Une table partagée lue sans son discriminant · E2
69. Des registres parallèles désynchronisés · E3
70. Une valeur écrite hors du vocabulaire déclaré · E4

## I · LE RAYON D'ACTION : ce qui coûte l'entreprise, pas des jours

Aucun incident grave recensé sur le terrain ne vient d'un câblage cassé. Tous viennent de
la même triade : un identifiant trop large que l'agent trouve seul, une action destructrice
sans garde mécanique, une sauvegarde à l'intérieur du périmètre détruit.

71. Un jeton d'infrastructure lisible depuis le dépôt · I2 ⏳ (règle partielle)
72. Un drapeau destructeur (`--force`, `--auto-approve`, `--force-reset`) dans un script · I5 ⏳
73. Une sauvegarde stockée dans ce qu'elle protège, ou jamais restaurée pour de vrai · I3
    (sur une base hébergée, la sauvegarde est côté plateforme : le signalement est à
    lire, pas à appliquer aveuglément)
74. Une liste noire de commandes là où il faut une liste blanche ⏳

## J · LA REDONDANCE : le pôle du câblage qu'on visait mal

Sur un grand corpus de changements publics, la duplication a monté de 81 % et la
réutilisation baissé de 35 % (`recherche-terrain.md`, partie 1). Le défaut dominant n'est pas
« rien n'appelle cette fonction », c'est « deux choses font la même chose différemment ».

75. Deux implémentations de la même règle métier ⏳ (outil de facto : `jscpd`)
76. Un événement à plusieurs entrées dont une seule est branchée : le déclencheur doit
    être posé au goulot commun, jamais sur une des portes ⏳
77. Une valeur qui a la forme de la vraie donnée et n'en vient pas (repli inventé) · E5

## La règle d'enrichissement

Tout nouveau type de problème rencontré sur un projet s'ajoute ici ET dans un détecteur,
dans la foulée, ET au banc de mesure (`banc/mesure/enrichir.mjs`) pour que le chiffre de
rappel baisse tant que le détecteur n'existe pas. Un problème constaté qui n'entre pas
dans la liste reviendra sur le projet suivant : c'est ainsi que la liste reste vraie.

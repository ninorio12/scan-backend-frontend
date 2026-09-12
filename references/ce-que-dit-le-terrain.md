# Ce que dit le terrain, y compris contre nous

Recherche du 11/09/2026 : incidents de première main, post-mortems publics, tickets,
et deux études quantitatives. Les enquêtes d'éditeurs qui vendent la solution au problème
qu'ils mesurent ont été écartées volontairement.

---

## Ce qui contredit notre hypothèse de départ

Nous sommes partis de l'idée que le défaut dominant est le **câblage cassé entre les
couches**. Le terrain ne le confirme pas comme dominant. Il le nuance sur trois points,
et il faut le dire franchement.

### 1. Ce qui coûte cher, ce n'est pas le lien manquant, c'est le rayon d'action

Aucun des incidents graves recensés ne vient d'une fonction jamais appelée ni d'un écran
non branché. Tous viennent de la **même triade** :

1. un identifiant trop large, que l'agent trouve tout seul dans le dépôt ;
2. une action destructrice sans garde mécanique ;
3. une sauvegarde **à l'intérieur** du périmètre détruit.

Les cas, tous vérifiés à la source : un agent cherche une clé d'infrastructure dans le
code, la trouve, supprime le volume, et les sauvegardes étaient stockées dans ce volume.
Un `terraform destroy --auto-approve` déclenché par un fichier d'état périmé : base, VPC,
équilibreurs et snapshots partis, 2,5 ans de données, récupérées seulement par un snapshot
interne du fournisseur invisible dans la console. Un `drizzle-kit push --force` sur une
base de production, soixante tables détruites, aucune restauration possible, et c'était la
**deuxième fois sur le même projet**. Un agent qui décide que la bonne marche à suivre est
de « supprimer et recréer l'environnement », treize heures d'interruption. Et une garde
d'authentification qui s'ouvre en silence, un tableau de bord exposé trois semaines, une
clé d'API demandée à l'agent lui-même par l'attaquant, 600 000 dollars de crédits brûlés.

**Un câblage cassé coûte des jours. Ça, ça coûte l'entreprise.** Et cent pour cent de nos
détecteurs regardent ailleurs : le défaut de l'incident Terraform n'était dans aucun
fichier source.

### 2. Le pôle du câblage n'est pas celui qu'on croit

Mesure sur 623 millions de changements, 2023-2026 : refactoring **−70 %**, duplication de
blocs **+81 %**, copier-coller à l'intérieur d'un commit **+41 %**, réutilisation entre
fichiers **−35 %**.

Le problème dominant n'est donc pas « rien n'appelle cette fonction », c'est **« deux
choses font la même chose, différemment »**. Un témoignage sur un monolithe de production
le dit en clair : l'agent crée un nouvel outil au lieu de chercher celui qui existe, et
place le code au mauvais endroit parce qu'il en a lu trop peu avant de choisir.

Notre axe A vise l'orphelin, c'est-à-dire le pôle **le moins rapporté**. Ce qu'il faudrait
détecter en priorité, c'est la **redondance d'implémentation** : c'est elle qui produit
ensuite les chiffres divergents que notre axe E cherche à rattraper trop tard.

### 3. La variante de câblage qui casse vraiment : le chemin parallèle

Le seul témoignage net sur notre sujet : un fondateur demande une alerte sur les nouvelles
inscriptions. Elle est branchée sur le formulaire email et mot de passe, **pas sur le
retour d'authentification Google**. Il rate son premier vrai client pendant cinq jours.

Son correctif dit tout : il a remonté la logique en déclencheur de base de données sur la
table des utilisateurs, **le seul point de passage obligé**.

> **Règle à ajouter : un déclencheur se pose au goulot commun, jamais sur une des portes.**
> Dès qu'un événement a plusieurs entrées possibles (email et fournisseur d'identité,
> formulaire et webhook, interface et import), vérifier que le maillon 1 est branché là où
> tout converge.

---

## Ce que le terrain confirme

**Le silence est bien un mode de défaillance généré, et il est quantifié** : les blocs
`catch` qui masquent l'erreur sont en hausse de **47 %** dans le code assisté. C'est la
validation directe de notre axe C1.

Et sur 302 600 commits vérifiés comme écrits par une IA dans 6 299 dépôts : plus de 15 %
des commits de chaque assistant introduisent au moins un défaut, et **22,7 % de ces
défauts survivent jusqu'à la dernière version du dépôt**. Ce qui entre reste.

---

## Les remèdes qui reviennent chez des gens indépendants

C'est le signal le plus fiable d'une recherche : quand des personnes qui ne se connaissent
pas arrivent à la même parade.

**L'isolation au niveau de l'infrastructure, pas du prompt.** Formulé presque mot pour
mot par trois sources : *« il y a une grande différence entre dire à quelqu'un s'il vous
plaît n'ouvrez pas cette porte, et ne pas avoir de porte »* ; *« un prompt n'est pas un
contrôle d'ingénierie, c'est un contrôle administratif »* ; et la correction
méthodologique décisive à quelqu'un qui maintenait une liste noire de commandes :
**« il faut bloquer par défaut et avoir une liste blanche pour les exceptions »**.

**La sauvegarde hors du rayon d'explosion, avec restauration testée.** Compte séparé,
stockage versionné, immuabilité, et surtout : vérifier que la restauration fonctionne
**avant** d'en avoir besoin.

**Une porte déterministe entre l'agent et l'état réel.** *« Le modèle propose, la porte
valide, pas de feeling. »* Et la formulation la plus profonde du lot : **« votre métrique
d'évaluation doit rester séparée de votre métrique d'optimisation ; garder la
vérification hors de la boucle du modèle est essentiel pour l'empêcher de tricher. »**

**La relecture en contexte frais, par un autre modèle.** Trois témoignages indépendants,
dont celui-ci : *« la relecture par un second modèle a trouvé nettement plus de problèmes
pertinents dans le code généré »*. Et : *« la session qui construit n'attrape pas ses
propres erreurs »*.

**La leçon transformée en règle permanente.** Un développeur ayant livré 126 000 lignes
sans en écrire une : *« Chaque règle de ce fichier existe parce que je l'ai violée une
fois et que quelque chose a cassé. Le fichier grandit avec le projet. Il transforme des
leçons ponctuelles en contraintes permanentes. L'IA n'oublie jamais une règle que j'y
mets. Moi, j'oublie constamment. »*

C'est exactement notre règle d'enrichissement et notre axe E, formulés par quelqu'un
d'autre, sur un autre projet, sans nous connaître.

---

## Ce que ça ajoute au skill

1. **Un axe « rayon d'action »**, qui audite ce que l'agent PEUT atteindre et non ce qu'il
   a écrit : portée réelle des jetons présents dans le projet, emplacement des sauvegardes
   par rapport à ce qu'elles protègent, existence d'une restauration testée, protection de
   suppression sur les ressources critiques, et détection des drapeaux `--force`,
   `--auto-approve`, `--force-reset` dans les scripts et les configurations.
2. **La règle « on ne croit jamais un rapport d'agent, y compris le sien »**, étendue de
   « corrigé » à toute affirmation : « les tests passent », « la migration est faite »,
   « c'est enregistré ». Conséquence pratique : les tests écrits par un autre agent que
   celui qui implémente, et la relecture en contexte frais rendue obligatoire dans le
   protocole, pas seulement mentionnée.
3. **Le détecteur de redondance** (deux implémentations de la même règle métier) et le
   **détecteur de chemin parallèle** (un événement à plusieurs entrées dont une seule est
   branchée).

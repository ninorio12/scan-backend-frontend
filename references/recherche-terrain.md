# La recherche de terrain : ce qui fonde la méthode, y compris contre nous

Trois recherches du 11/09/2026, réunies ici parce qu'elles répondent à la même question :
qu'est-ce qui casse vraiment, comment le métier l'appelle, et qu'est-ce qui tient. Les
enquêtes d'éditeurs qui vendent la solution au problème qu'ils mesurent ont été écartées
volontairement. Chaque affirmation est sourcée ; ce qui n'était pas vérifiable n'y figure pas.

- Partie 1 — ce que dit le terrain, y compris contre notre hypothèse de départ.
- Partie 2 — les noms que le vrai dev donne à notre méthode.
- Partie 3 — ce qui marche vraiment quand on outille un agent.

---

## Partie 1 · Ce que dit le terrain, y compris contre nous

Recherche du 11/09/2026 : incidents de première main, post-mortems publics, tickets,
et deux études quantitatives. Les enquêtes d'éditeurs qui vendent la solution au problème
qu'ils mesurent ont été écartées volontairement.

---

### Ce qui contredit notre hypothèse de départ

Nous sommes partis de l'idée que le défaut dominant est le **câblage cassé entre les
couches**. Le terrain ne le confirme pas comme dominant. Il le nuance sur trois points,
et il faut le dire franchement.

#### 1. Ce qui coûte cher, ce n'est pas le lien manquant, c'est le rayon d'action

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

#### 2. Le pôle du câblage n'est pas celui qu'on croit

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

#### 3. La variante de câblage qui casse vraiment : le chemin parallèle

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

### Ce que le terrain confirme

**Le silence est bien un mode de défaillance généré, et il est quantifié** : les blocs
`catch` qui masquent l'erreur sont en hausse de **47 %** dans le code assisté. C'est la
validation directe de notre axe C1.

Et sur 302 600 commits vérifiés comme écrits par une IA dans 6 299 dépôts : plus de 15 %
des commits de chaque assistant introduisent au moins un défaut, et **22,7 % de ces
défauts survivent jusqu'à la dernière version du dépôt**. Ce qui entre reste.

---

### Les remèdes qui reviennent chez des gens indépendants

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

### Ce que ça ajoute au skill

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

---

## Partie 2 · Ce que le vrai dev appelle ça

Recherche du 11/09/2026. Notre méthode n'est pas une invention : elle redécouvre des
principes établis depuis vingt ans. Les connaître donne les bons mots et évite de
réinventer de travers.

### Ce n'est pas un problème de backend

Le backend peut être parfait et le produit cassé quand même. Le défaut vit **entre les
couches**, dans les coutures. Le métier appelle ça un problème d'**intégration**, et il
a une cause connue : le sens du découpage.

**Découpage horizontal** (le nôtre jusqu'ici) : on fait tous les écrans, puis les
modules, puis « on met la tech derrière ». Une feature finit éparpillée dans cinq ou six
dossiers, et rien ne garantit que les morceaux se rejoignent. C'est la fabrique à liens
perdus.

**Découpage vertical** (vertical slice) : on prend une seule feature et on la construit
entière, de l'écran jusqu'à la table, avant de passer à la suivante. Chaque tranche est
autonome, testable, livrable. Moins de bugs d'intégration, parce qu'il n'y a jamais de
moment où les morceaux attendent d'être réunis.

### Walking skeleton, steel thread, tracer bullet

Trois noms pour la même chose. Alistair Cockburn, le *walking skeleton* :

> « Une implémentation minuscule du système qui réalise une petite fonction de bout en
> bout. Elle n'a pas besoin d'utiliser l'architecture finale, mais elle doit **relier
> entre eux les principaux composants**. L'architecture et les fonctionnalités évoluent
> ensuite en parallèle. »

Les *Pragmatic Programmers* l'appellent **tracer bullet** : une balle traçante qui
traverse toutes les couches, en code de production, pour voir où elle atterrit avant
d'en tirer mille.

La formulation la plus utile pour nous : *la plupart des constructeurs bâtissent chaque
pièce puis les connectent ; le steel thread connecte toutes les couches dès le départ,
même minimalement.*

**C'est exactement notre règle « un écran naît branché », mais à l'échelle du projet.**
Sur un nouveau SaaS, la première chose à construire n'est pas un écran ni un schéma :
c'est **une tranche unique qui va du clic jusqu'à la table et revient**, si maigre
soit-elle. Tant qu'elle ne marche pas, on ne construit rien d'autre.

### Le trou que les tests ne couvrent pas

Le contract testing (Pact) existe pour une raison précise : les tests unitaires simulent
le réseau, donc ils ne voient jamais les bugs d'intégration. L'exemple canonique :

> Une équipe paiements renomme un champ JSON `amount_cents` en `amount`, un « nettoyage
> rétrocompatible ». L'équipe facturation consommait ce champ, testée en isolation avec
> des bouchons correspondant à l'ancien contrat. Les deux équipes avaient mis à jour
> leurs propres bouchons. **Aucun test n'a échoué. L'intégration n'a cassé qu'en
> production.**

C'est notre bug Sophie Martin sous un autre costume : chaque moitié est correcte, la
couture ne l'est pas. Personne ne teste les coutures par accident : il faut les viser.

### Les chiffres 2026 sur le code généré par IA

Utiles parce qu'ils montrent que le problème est structurel, pas une négligence :

- **43 %** des changements de code générés par IA demandent un débogage en production,
  **même après être passés par la QA et la préproduction**.
- Les **échecs d'intégration** touchent environ **30 %** des organisations, sous forme de
  dérive de schéma et de violations de contrat en amont.
- Le code généré introduit environ **1,7 fois plus** d'incidents critiques à l'exécution
  que du code relu par un humain.
- Des équipes SRE passent jusqu'à **un tiers de leur semaine** à trier et réparer des
  défaillances de code généré.

Conclusion pratique : passer la compilation, la QA et la préproduction ne prouve rien sur
les coutures. Seule une traversée réelle de bout en bout le fait.

### L'analyse de teinte, retournée

La discipline qui sait suivre une donnée à travers du code s'appelle l'analyse de teinte
(*taint analysis*). En sécurité : une SOURCE non fiable (entrée utilisateur), des
PROPAGATEURS (affectations, appels), un PUITS dangereux (requête SQL, `eval`), et on
alerte si la donnée atteint le puits sans avoir été nettoyée. C'est ce que font Semgrep
(`mode: taint`) et CodeQL.

Notre problème est le **miroir exact** : les sources sont les vraies lectures de données,
les puits sont les endroits d'affichage, et le défaut n'est pas qu'une donnée sale
arrive quelque part, c'est qu'**un endroit d'affichage n'est alimenté par rien**. Même
machinerie, alerte inversée. C'est ce que fait `scripts/flux.mjs`, avec le compilateur
TypeScript du projet.

Retenir aussi l'outillage : `ts-morph` enveloppe l'API du compilateur pour ce genre
d'analyse, et Semgrep permet d'écrire des règles de flux en YAML sans compilateur. Notre
script n'utilise ni l'un ni l'autre (zéro dépendance à installer chez le client), mais
c'est là qu'il faudra aller si l'analyse doit traverser les fichiers.

### Ce qu'on en retient dans le skill

1. Construire **par tranche verticale**, jamais par couche.
2. Sur un projet neuf, commencer par le **squelette qui marche** : une tranche
   complète, du clic à la table, avant tout le reste.
3. Viser les **coutures** explicitement : ce sont elles qui cassent, et aucun test ne les
   couvre par hasard.
4. La preuve est une **traversée réelle**, pas un build vert.

### Sources

- Walking skeleton, Alistair Cockburn : https://codeclimate.com/legacy/kickstart-your-next-project-with-a-walking-skeleton
- Tracer bullets, The Pragmatic Programmer : https://www.barbarianmeetscoding.com/notes/books/pragmatic-programmer/tracer-bullets/
- Steel thread, construire avec l'IA sans brûler le budget : https://bryceyork.com/steel-threads/
- Walking skeleton / steel thread, playbook Equal Experts : https://playbooks.equalexperts.com/mlops-playbook/practices/create-a-walking-skeleton-steel-thread
- Vertical slice architecture : https://milanjovanovic.tech/blog/vertical-slice-architecture-structuring-vertical-slices
- Contract testing, Pact : https://docs.pact.io/
- Analyse de teinte, Semgrep : https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/overview
- ts-morph, API du compilateur TypeScript : https://github.com/dsherret/ts-morph
- État du code généré par IA en production, 2026 : https://venturebeat.com/technology/43-of-ai-generated-code-changes-need-debugging-in-production-survey-finds
- State of AI-Powered Engineering 2026, Lightrun : https://www.globenewswire.com/news-release/2026/04/14/3273542/0/en/lightrun-s-2026-state-of-ai-powered-engineering-report-almost-half-of-ai-generated-code-fails-in-production.html

---

## Partie 3 · Ce qui marche vraiment, vérifié à la source

Recherche du 11/09/2026, faite avec un harnais de recherche (hors du skill) : API GitHub, Hacker News,
documentations officielles lues intégralement. Chaque affirmation ci-dessous est sourcée.
Ce qui n'est pas vérifiable n'y figure pas.

---

### 1. Un skill ne se déclenche pas tout seul. C'est mesuré.

Vercel a construit une suite d'évaluations sur les APIs de Next.js 16, absentes des
données d'entraînement des modèles, puis comparé trois façons de fournir la connaissance.

| Configuration | Réussite |
|---|---|
| Sans documentation | 53 % |
| **Skill disponible, déclenchement laissé au modèle** | **53 %** |
| Skill + instruction explicite de l'invoquer | 79 % |
| **Index compressé de 8 Ko dans le fichier de contexte** | **100 %** |

Dans **56 % des cas, le skill n'a jamais été invoqué**. Pire : sur certaines métriques il
a fait moins bien que l'absence de documentation, un skill inutilisé ajoutant du bruit.

Conséquence directe pour nous : les règles qui doivent s'appliquer **toujours** ne peuvent
pas vivre uniquement dans un skill. Elles vivent dans le fichier de contexte du projet.
Le skill est fait pour le travail **vertical qu'on déclenche exprès** : « audite ce
SaaS », « répare le câblage ». Les deux sont complémentaires, ils ne sont pas
interchangeables. Voir `references/bloc-claude-md.md`.

Autre enseignement repris tel quel : **compresser agressivement**. Un index qui pointe
vers des fichiers vaut autant que le contenu complet, pour 20 % de la place.

Source : https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals

### 2. Un skill mal formé est invisible, et personne ne le voit

`agnix` (409 étoiles, 455 règles) valide les fichiers de configuration d'agents :
`CLAUDE.md`, `SKILL.md`, hooks, MCP. Une ligne de son argumentaire nous concernait
directement : *« Vos skills ne se déclenchent pas. Un seul champ erroné et votre skill
est invisible. »*

Lancé sur notre propre skill le 11/09/2026, il a trouvé une **erreur de parsage** : la
description contenait des deux-points non protégés, ce qui casse le frontmatter YAML.
L'outil qui traque les câblages cassés était lui-même mal câblé.

**`npx agnix .` fait partie du câblage.** À lancer sur tout projet qui porte des skills.

Source : https://github.com/agent-sh/agnix

### 3. La hiérarchie qui résiste à la dérive

`claude-enforcer` formalise ce qu'on avait découvert empiriquement, et le relie à la
recherche : dans une longue conversation, les consignes du début se diluent sous tout ce
qui suit (*lost in the middle*, arXiv 2307.03172).

| Couche | Résiste à la dérive ? |
|---|---|
| Fichier de contexte | Non, mais toujours chargé |
| Règles, skills | Non |
| **Hooks** | **Oui** — blocage déterministe |
| **Agents en contexte isolé** | **Oui** — jugement non contaminé |

Et la tension à ne pas nier : *« la validation garde l'IA honnête, mais trop de validation
l'empêche de travailler »*. Leur parade, qu'on reprend : les contrôles **mécaniques**
(grep, regex, checksum) tournent à chaque édition ; les validateurs **coûteux** ne se
déclenchent que quand le changement est réel, avec un pré-contrôle déterministe qui évite
de lancer un agent pour rien.

Sources : https://github.com/odysseyalive/claude-enforcer · https://arxiv.org/abs/2307.03172

### 4. Le vrai problème n'est pas l'hallucination, c'est l'absence de mémoire

Le témoignage le plus juste trouvé sur le sujet, par quelqu'un qui a construit sur tous
les outils du marché :

> « Le motif qui casse les choses n'est pas l'hallucination. C'est l'absence d'état.
> L'agent ne sait pas que vous avez annulé cette migration il y a six semaines parce
> qu'elle provoquait des pannes en cascade sous charge. Il ne sait pas que le postmortem
> de votre équipe a conclu que ce motif était définitivement interdit. Il n'a aucune
> notion du pourquoi le code est ce qu'il est, seulement de ce à quoi il ressemble
> aujourd'hui. Le résultat : une production **architecturalement assurée,
> syntaxiquement propre, opérationnellement dangereuse**. Ça passe la revue. Ça part en
> production. Puis ça casse quelque chose que vous aviez déjà cassé. »

C'est exactement la raison d'être de notre **axe E**, « les pièges déjà payés » : un
défaut qui nous a coûté une fois nous recoûtera, parce que la session suivante ne se
souvient de rien. La seule mémoire fiable est un détecteur.

Source : https://news.ycombinator.com/item?id=47399209

### 5. Pour Convex, ne pas réinventer : il existe un linter officiel

`@convex-dev/eslint-plugin` (et son portage `convex-oxlint`, 6 à 10 fois plus rapide)
applique six règles, dont trois recoupent nos propres détecteurs :

| Règle officielle | Gravité | Ce qu'elle fait | Chez nous |
|---|---|---|---|
| `require-args-validator` | erreur | validateur `args` sur chaque fonction | = B2 |
| `no-filter-in-query` | avertissement | décourage `.filter()` sur une query | = C3 |
| `no-collect-in-query` | — | décourage `.collect()`, préférer `take`/`paginate` | = C6 |
| `explicit-table-ids` | erreur | nom de table explicite dans `db.get/patch/replace/delete` | **manquant chez nous** |
| `no-old-registered-function-syntax` | erreur | syntaxe objet obligatoire | **manquant chez nous** |
| `import-wrong-runtime` | désactivée | seul un module `"use node"` importe du `"use node"` | non couvert |

**Décision : sur un projet Convex, on installe le plugin officiel et on le laisse faire
ces six règles.** Notre auditeur se concentre sur ce qu'aucun linter ne fait : le
câblage entre les couches, les surfaces fantômes, les contrats d'appel, nos incidents.
Réimplémenter ce qui existe officiellement, c'est prendre la dette de le maintenir.

```bash
npm i -D oxlint convex-oxlint
echo '{ "extends": ["./node_modules/convex-oxlint/oxlintrc.recommended.json"] }' > .oxlintrc.json
npx oxlint
```

Sources : https://docs.convex.dev/eslint · https://github.com/aaly00/convex-oxlint

---

### Ce que cette recherche change dans le skill

1. Un bloc court et dense va dans le `CLAUDE.md` de chaque projet : les règles qui
   doivent survivre à la dilution ne peuvent pas dépendre d'une invocation.
2. `npx agnix .` entre dans le protocole : un skill invalide est un skill absent.
3. Sur Convex, le linter officiel est installé et notre auditeur ne double pas ses règles.
4. Les contrôles mécaniques restent sur le chemin chaud, les agents sur le chemin froid.
5. L'axe E n'est pas une coquetterie : l'absence de mémoire institutionnelle est **le**
   mode de défaillance dominant, documenté par ceux qui l'ont vécu.

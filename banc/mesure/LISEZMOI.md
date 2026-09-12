# Le harnais de mesure du skill backend

    node mesurer.mjs --fige            # 0,2 s — les deux chiffres sur le banc figé
    node mesurer.mjs --enregistre      # 6 min — + 40 mutations tirées sur du code réel
    node cliquet.mjs --verifier        # a-t-on empiré ? (code 1 si régression)
    node cliquet.mjs --canari          # l'auditeur reconnaît-il son banc ?
    node juges/tsc.mjs banc/fige     # le juge qu'on n'a pas écrit
    node moissonner.mjs --lister       # 219 défauts réels dans l'historique git
    node enrichir.mjs ...              # un bug du terrain entre au banc et fait BAISSER le chiffre

Mesure du 11/09/2026, graine 4242, auditeur `75689b6e1526f892` :

| | valeur | IC 95 % | brut |
|---|---|---|---|
| **RAPPEL** (vu ET diagnostiqué) | **22,8 %** | [13,8 – 35,2] | 13/57 |
| **JUSTESSE** (signalement arbitré vrai) | **92,6 %** | [85,6 – 96,4] | 88/95 |
| rappel, banc figé seul | 34,6 % | [19,4 – 53,8] | 9/26 |
| rappel, mutations sur code réel | 12,9 % | [5,1 – 28,9] | 4/31 |
| rappel si on se contente du bon fichier | 66,7 % | [53,7 – 77,5] | 38/57 |

---

## 0. Pourquoi ce dossier vit ici et pas dans /tmp

Le 11/09/2026, un redémarrage a effacé le banc de 20 défauts et sa vérité terrain. Ils
vivaient dans un dossier temporaire. **L'instrument de mesure a disparu, et avec lui tout
ce qu'on croyait savoir du skill.** C'est le meilleur argument possible pour ce qui suit :

- le banc **figé** vit désormais dans `verite/`, à côté du skill, sauvegardé avec lui ;
- le banc **génératif** ne peut pas se perdre : il n'a pas de fichiers. Il est une
  fonction de (nos trois dépôts produits, une graine). `--graine=4242` le régénère à
  l'identique, avant comme après le redémarrage. C'est ce qui s'est passé : il est revenu
  seul, avec 6 747 sites candidats au lieu de 6 739, l'écart étant le travail de la journée
  sur les dépôts.

---

## 1. Deux chiffres, et deux organes qu'on confondait

| Organe | Ce que c'est | Ce qui le mesure ici |
|---|---|---|
| **le scanner** | `scripts/audit-backend.mjs`, 48 règles, déterministe | `mesurer.mjs` |
| **la doctrine** | `SKILL.md`, 599 lignes, appliquée par un agent qui lit le code | `juges/plugin-backend` (ablation native) |

Le « 1 sur 20 » historique mesurait le scanner. Le « 54 % de justesse » mesurait la
doctrine. Les mettre côte à côte comme s'ils décrivaient un seul objet était déjà une
erreur de mesure. Les deux chiffres publiés en tête concernent **le scanner**.

**RAPPEL** : quelle part des défauts connus est vue.
**JUSTESSE** : quelle part de ce qui est signalé est vraie.

Chacun sort avec son **intervalle de Wilson à 95 %**. 54 % sur 26 cas est compatible avec
35 % comme avec 72 % ; un chiffre sans son intervalle est une opinion avec une décimale.

---

## 2. Le rappel a trois niveaux, et l'écart entre eux est l'information

| Niveau | Condition | Résultat |
|---|---|---|
| 1. localisation | le signalement nomme le bon fichier | 66,7 % |
| 2. précis | + le bon symbole, ou une ligne à ±12 | 57,9 % |
| 3. **diagnostic** | + la règle qui a parlé prétend chercher **cette famille** | **22,8 %** |

Trois fois le même détecteur, un facteur trois. Publier le premier serait malhonnête : il
crédite l'auditeur d'avoir vu un défaut parce qu'il parlait du même fichier, pour une
raison sans rapport. Le niveau 3 est le seul qui exige qu'il ait **compris**.

L'ancien `scripts/test-detecteurs.mjs` fait l'inverse : il contient des lignes comme
`['A1', /listeMorte/]`, une table rédigée **après** avoir vu la sortie. Ça ne mesure pas le
détecteur, ça le photographie.

---

## 3. Les bancs existants, évalués franchement

| Banc | Vérité terrain | Verdict |
|---|---|---|
| `fixtures/repo-piege` (dans le skill) | dans `test-detecteurs.mjs`, en regex sur la sortie observée | **ne mesure rien.** Test de non-régression utile (il dit si un détecteur s'est tu), pas une mesure de rappel. |
| `banc/fige` | **aucune** avant aujourd'hui | 17 fichiers, 1 842 lignes. **Devenu le banc figé** : sa vérité a été écrite ici, à la lecture. |
| `piege3` + `verite3.md` (20 défauts) | oui | **perdu** au redémarrage. Sa disparition est la raison d'être de ce dossier. |
| `banc-scan`, `piege7` | **aucune** | ne mesurent rien. Utilisables comme sources de mutation. |

**Comment la vérité de banc2 a été écrite.** Les 17 fichiers ont été lus ligne à ligne
**avant** toute exécution de l'auditeur, et 26 défauts relevés. Aucun n'a été ajouté ni
retiré après avoir vu une sortie de détecteur : c'est la seule discipline qui distingue une
vérité terrain d'une photographie du détecteur. Les défauts n'ont pas été plantés, ils
étaient déjà là : banc2 a été écrit comme un SaaS plausible, pas comme un piège. Cinq
familles neuves en sont sorties, dont deux qu'aucune règle du skill ne couvre
(`ETAT_ECRASE`, `RECHERCHE_MUETTE`).

**Et une règle dure, appliquée le jour même.** L'auditeur a trouvé un défaut que la lecture
humaine avait manqué, et c'est le plus grave du dépôt : `convex/auth.config.ts` est absent,
donc `getUserIdentity()` rend toujours `null`, donc `proprietaires.creer` et `modifier`
lèvent systématiquement. Ce défaut **reçoit un crédit de justesse** (verdict « vrai », avec
sa preuve) et **n'entre pas dans la vérité terrain**. L'y mettre ferait monter le rappel par
auto-confirmation : le détecteur aurait écrit sa propre épreuve.

---

## 4. Le banc de référence : trois étages, dont deux qu'on ne contrôle pas

### Étage 1 — figé : 26 défauts, 0,2 s
`banc/fige`, vérité dans `verite/banc2.json`, arbitrage dans `verdicts/banc2.json`,
scellé par empreinte. Assez rapide pour tourner à chaque modification d'un détecteur, ce
qui est la seule façon qu'il tourne vraiment.

### Étage 2 — génératif : 40 mutations par mesure, tirées parmi 6 747 sites
**La pièce centrale du protocole anti-triche.** Dix opérateurs prennent du code **réel** de
`<projet-client-B>`, `<projet-client-A>` et `projet client C`, et en produisent la maladie à un
emplacement tiré d'une graine. Le banc n'existe pas avant la mesure : on ne peut pas
apprendre par cœur un banc qui change à chaque appel, la seule façon de faire monter le
chiffre est de détecter la **famille**.

Contrainte d'écriture des opérateurs, la quatrième et la plus importante : **un opérateur
part du symptôme vu par le client, jamais d'un détecteur**, et il lui est interdit de citer
un identifiant de règle. Un opérateur qui décrirait un détecteur ferait mesurer le
détecteur par lui-même.

### Étage 3 — moisson de l'historique git : 219 défauts réels

```
qos          44 cas exploitables sur  738 commits
projet client C    175 cas exploitables sur 3958 commits
```

Chaque commit `fix(...)` touchant `convex/` ou une route d'API prouve qu'un défaut existait
au commit **parent** et n'existait plus après. La vérité terrain, c'est le **diff**, écrit
des mois avant que le skill existe. Le critère devient infalsifiable par nous : *l'auditeur
signale-t-il, au commit cassé, quelque chose à l'endroit du correctif, et se tait-il
après ?* Trois issues — **VU**, **MANQUÉ**, **CRIE**. La troisième est celle qu'aucun banc
maison n'attrape : un détecteur qui crie partout a un rappel parfait sur des défauts
plantés et échoue ici, parce que le correctif humain ne le fait pas taire.

---

## 5. Le juge extérieur : ce qu'on installe au lieu de l'écrire

La leçon d'Addy Osmani : *« can the agent make this pass by writing code that doesn't
work ? »* — externe, projet, ou notre propre suite, la seule vraiment circulaire. Notre
skill était entièrement du troisième type.

### Juge A — `tsc --noEmit` : il tranche, et son verdict est net

```
$ node juges/tsc.mjs banc/fige --motifs=ville,journal,requireCourtier,...
JUGE EXTÉRIEUR — tsc --noEmit sur banc/fige   (2.3s)
  131 erreur(s) de type
     115 × TS7006      15 × TS2307      1 × TS7053

  Erreurs qui nomment un des 26 défauts de câblage connus : 0
  → AUCUNE. Le compilateur ne voit rien de ces défauts : le territoire du skill
    existe, et il est disjoint du sien.
```

C'est la déclaration de territoire la plus solide du dossier, et elle ne vient pas de nous :
131 erreurs du compilateur, zéro qui nomme un seul des 26 défauts que le client subirait.
Le même juge sert de filtre au banc génératif : une mutation que `tsc` attrape n'est pas un
défaut de câblage, c'est une faute de frappe, et elle n'a rien à faire au banc.

### Juge B — `claude plugin eval`, le harnais d'ablation natif, déjà installé

Claude Code 2.1.268 embarque un évaluateur avec **bras d'ablation natif**, éteint derrière
un drapeau d'accès anticipé. Il tourne :

```
$ CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval juges/plugin-backend --scaffold \
    --judge-model haiku --max-cost-usd 1.50
Ablation: defaulting to with-without — a plugin resolved from this path, so each case
also runs a no-plugin baseline arm and reports Δ
Plugin under test: "backend-sous-test" at ".../juges/plugin-backend"

BRAS WITH     score 0  tours 18  $0.551
BRAS WITHOUT  score 0  tours 11  $0.189
{"casesTotal":1,"casesPassed":0,"overallScore":0,"meanDelta":0}   coût total $0.740
```

C'est le juge qui compte le plus pour la **doctrine** : il monte tout seul un bras **sans le
skill** et rapporte le delta. Un skill qui ne change rien obtient un delta nul, quoi qu'en
dise son SKILL.md. Et le fait que la skill se déclenche est traité comme un **voyant**, pas
comme un point (`graders marked with-only, incl. tool_used: Skill, are a plugin-fired
indicator rather than part of the score`) : impossible de gagner des points en s'activant
pour rien.

**État réel, sans bluff : le Δ = 0 ci-dessus ne mesure pas encore le skill.** Le bac à sable
de l'éval confine l'agent à son répertoire de travail, il ne peut pas lire `banc/fige`, et
mes deux tentatives de l'y installer (`scaffold_script` à la racine du cas puis sous
`execution:`) n'ont pas été exécutées — le script témoin n'a jamais écrit sa trace. Les deux
bras ont donc échoué pour la même raison, étrangère au skill. Ce qui est prouvé : le juge
existe, il résout le skill comme plugin, il monte les deux bras, il coûte 0,19 $ sans et
0,55 $ avec, et il rend un verdict que nous ne contrôlons pas. Ce qui reste à faire : une
ligne de mise en scène du dépôt dans le bac à sable.

`juges/plugin-backend/skills/scan-backend-frontend` est un **lien symbolique** vers le skill réel, jamais
une copie ni une modification.

---

## 6. Le protocole anti-triche, et sa liste négative

Un banc dont l'agent connaît les réponses ne mesure rien.

| Triche | Ce qui l'en empêche |
|---|---|
| apprendre le banc par cœur | le banc génératif est tiré à la mesure, parmi 6 747 sites |
| retirer du banc le cas qu'on rate | `cliquet.mjs` §3 : un identifiant **retiré** bloque le run ; un **ajouté** passe |
| requalifier un signalement gênant en « faux » | `cliquet.mjs` §4 : le sceau de `verdicts/*.json` change, la trace est datée, chaque verdict porte sa preuve |
| relâcher le barème d'appariement | `cliquet.mjs` §5 : `lib/appariement.mjs`, `familles.mjs` et `mutateurs/operateurs.mjs` sont scellés ; s'ils bougent, le run est **non comparable** et ne peut pas devenir la référence |
| faire reconnaître le banc par l'auditeur | le **canari** : le même dépôt audité à deux emplacements aléatoires sous deux noms doit rendre un verdict identique. Vérifié, il le rend |
| gonfler le rappel en signalant tout | l'étage 3 : un signalement qui survit au correctif humain compte **CRIE**, pas **VU** |
| gonfler le rappel par coïncidence de localisation | niveau 3 de l'appariement : la règle doit prétendre chercher cette famille |
| se faire noter par le bruit de fond du projet | **justesse différentielle** : seuls les signalements apparus entre le dépôt sain et le dépôt muté sont notés. projet client C en produit 2 048 au repos |
| se confirmer soi-même | un défaut trouvé PAR l'auditeur va aux verdicts, **jamais** à la vérité terrain |

### LISTE NÉGATIVE

1. **Ne jamais modifier un dépôt réel.** Lus, copiés, jamais écrits. Seule la copie est mutée.
2. **Ne jamais modifier le skill mesuré.** Un harnais qui corrige son examiné ne mesure plus.
3. **Ne jamais écrire un opérateur de mutation en lisant un détecteur.** Interdiction de citer `A1`, `D2` dans `mutateurs/`.
4. **Ne jamais retirer un cas du banc pour faire monter le chiffre.** Un cas ne se retire que s'il est prouvé invalide, preuve écrite.
5. **Ne jamais compter « non listé » = « faux positif ».** C'est l'erreur qui transformait 94 % de justesse en 50 %. Sans verdict, un signalement va au seau « non arbitré », qui est une dette visible, pas un score.
6. **Ne jamais publier un chiffre sans son n et son intervalle.**
7. **Ne jamais comparer deux runs dont le barème a changé.**
8. **Ne jamais ajuster le barème après avoir vu le score.** Les trois niveaux ont été écrits avant la première mesure ; c'est pour ça que le rapport publie les trois, y compris celui qui flatte le skill.
9. **Ne jamais ajouter à la vérité terrain un défaut découvert par le détecteur.**
10. **Ne jamais laisser un `exit 2` passer pour un `exit 0`.** Un harnais qui n'a pas pu tourner n'est pas un harnais qui a dit oui.

---

## 7. Le cliquet

Repris de `constraint-driven-development` : ne fixe pas un objectif que tu rates, enregistre
où tu en es et refuse de descendre. Un objectif à 80 % raté depuis trois mois ne fait rien
bouger ; un plancher à 22,8 % qu'on ne peut plus franchir vers le bas fait bouger tout de
suite. Une baisse ne bloque que si elle est **statistiquement significative** (deux
proportions, unilatéral, α = 0,05) ; sans ça le cliquet se déclenche sur le bruit
d'échantillonnage et finit désactivé, c'est-à-dire nul.

```
CLIQUET — plancher posé le 2026-09-11 16:45
  ✓ rappel     22.8 % (13/57)  =   22.8 % (13/57)   baisse non significative (p=0.500)
  ✓ justesse   92.6 % (88/95)  =   92.6 % (88/95)   baisse non significative (p=0.500)
  ✓ banc banc2      26 défauts
  ✓ canari de chemin : verdict stable à deux emplacements
  · auditeur inchangé (75689b6e1526f892) : toute variation vient du banc, pas du détecteur.
  ✓ Pas de régression.
```

**Quand ça baisse, c'est la trouvaille.** Deux causes, et le rapport les sépare : le
détecteur a régressé (son empreinte a changé), ou le banc s'est enrichi (un identifiant a
été ajouté). Le second cas n'est pas une panne, c'est la mesure qui fait son travail.

---

## 8. L'enrichissement

    node enrichir.mjs --repo=projet client C --fichier=convex/rush.ts --ligne=2955 \
        --famille=LOCATAIRE --resume="la vignette d'un autre client apparaît dans le lecteur"

> **Un bug du terrain entre au banc AVANT d'être corrigé, et il fait baisser le chiffre
> jusqu'à ce que le détecteur existe.**

Le cas est figé à un **commit**, pas à un état de travail : la correction du jour même ne le
fait pas disparaître du banc. Si aucune famille ne colle, l'outil refuse et demande d'en
créer une **sans détecteur**. Une famille sans règle n'est pas un oubli, c'est une
information : il y en a **5 sur 26** aujourd'hui — `DRILLDOWN`, `REGLAGE_INERTE`,
`ORDRE_IMPLICITE`, `ETAT_ECRASE`, `RECHERCHE_MUETTE`.

---

## 9. Qui tourne quand

| Quand | Quoi | Coût | Bloque ? |
|---|---|---|---|
| à chaque modification d'un détecteur | `mesurer.mjs --fige` + `cliquet.mjs --verifier` | 3 s | oui |
| avant de livrer une version du skill | `mesurer.mjs --graine=<date> --enregistre` | 6 min | oui |
| une fois par semaine, sans surveillance | `mesurer-moisson` sur un lot tiré des 219 | heures | non, alerte |
| à chaque bug remonté par un client | `enrichir.mjs` puis mesure | 1 min | non |
| avant toute publication d'un chiffre | `cliquet.mjs --canari` | 2 s | oui |

---

## 10. Ce que ce harnais NE résout pas

1. **La justesse sur du code réel reste non mesurée.** L'auditeur sort **2 048**
   signalements sur projet client C, 1 586 sur projet client B, 641 sur projet client A. Aucun arbitre ne peut trancher
   2 048 lignes. La justesse différentielle ne juge que le delta d'une mutation.
2. **Le banc génératif ne couvre que 10 familles sur 26**, et les manquantes sont les pires
   pour le client : deux définitions du même terme, un chiffre cliquable qui ne mène pas à
   son décompte, une colonne absente de la projection. Elles naissent d'une *intention*, pas
   d'une ligne retirée ; un opérateur syntaxique ne sait pas les fabriquer.
3. **Le juge d'ablation n'a pas encore rendu de verdict valide sur le skill** (§5, juge B).
4. **Représentativité.** Les trois dépôts sortent de la même main, même stack, même style.
   C'est une mesure de *notre* skill sur *nos* projets.
5. **L'arbitrage reste interne.** Chaque verdict porte sa preuve et se conteste, mais aucun
   outil tiers ne sait trancher « ce signalement de câblage est-il vrai ». Le compilateur
   répond à une autre question.
6. **Le rappel publié est une borne basse.** L'appariement strict manque au moins un cas
   (`A2` sur la table `journal`) où le détecteur a raison mais ne cite aucun fichier. Le
   barème n'a pas été retouché après l'avoir constaté : c'est la règle n° 8.
7. **L'organe doctrine coûte un agent par cas.** Pour un intervalle de ±10 points il
   faudrait 97 exécutions d'agent. C'est mesurable, c'est cher, et le harnais ne rend pas
   ça gratuit.
8. **Rien ici ne prouve que corriger un défaut détecté rend le produit meilleur.** On mesure
   la détection, pas la valeur.

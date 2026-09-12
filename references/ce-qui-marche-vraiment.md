# Ce qui marche vraiment, vérifié à la source

Recherche du 11/09/2026, faite avec un harnais de recherche (hors du skill) : API GitHub, Hacker News,
documentations officielles lues intégralement. Chaque affirmation ci-dessous est sourcée.
Ce qui n'est pas vérifiable n'y figure pas.

---

## 1. Un skill ne se déclenche pas tout seul. C'est mesuré.

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

## 2. Un skill mal formé est invisible, et personne ne le voit

`agnix` (409 étoiles, 455 règles) valide les fichiers de configuration d'agents :
`CLAUDE.md`, `SKILL.md`, hooks, MCP. Une ligne de son argumentaire nous concernait
directement : *« Vos skills ne se déclenchent pas. Un seul champ erroné et votre skill
est invisible. »*

Lancé sur notre propre skill le 11/09/2026, il a trouvé une **erreur de parsage** : la
description contenait des deux-points non protégés, ce qui casse le frontmatter YAML.
L'outil qui traque les câblages cassés était lui-même mal câblé.

**`npx agnix .` fait partie du câblage.** À lancer sur tout projet qui porte des skills.

Source : https://github.com/agent-sh/agnix

## 3. La hiérarchie qui résiste à la dérive

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

## 4. Le vrai problème n'est pas l'hallucination, c'est l'absence de mémoire

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

## 5. Pour Convex, ne pas réinventer : il existe un linter officiel

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

## Ce que cette recherche change dans le skill

1. Un bloc court et dense va dans le `CLAUDE.md` de chaque projet : les règles qui
   doivent survivre à la dilution ne peuvent pas dépendre d'une invocation.
2. `npx agnix .` entre dans le protocole : un skill invalide est un skill absent.
3. Sur Convex, le linter officiel est installé et notre auditeur ne double pas ses règles.
4. Les contrôles mécaniques restent sur le chemin chaud, les agents sur le chemin froid.
5. L'axe E n'est pas une coquetterie : l'absence de mémoire institutionnelle est **le**
   mode de défaillance dominant, documenté par ceux qui l'ont vécu.

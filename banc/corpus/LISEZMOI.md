# banc/corpus — les défauts que nous avons vraiment commis

Le reste du banc est de notre main : nous écrivons les mutations, la vérité terrain, l'arbitrage.
Il mesure donc notre capacité à retrouver ce que nous avons imaginé. Ce dossier-ci mesure autre
chose : notre capacité à retrouver ce que nous avons **réellement cassé**, dans nos SaaS, des mois
avant que ce skill existe.

La vérité terrain n'est écrite par personne qui pensait aux détecteurs : c'est le **diff d'un
commit de correction**, et le message qu'un humain a rédigé pour dire ce qui n'allait pas.

## La chaîne, dans l'ordre

```
1. moissonner-corpus.mjs   → travail/candidats.json    (les commits qui annoncent une correction)
2. dossiers.mjs            → travail/dossiers/lot-N.md (message + diff, un dossier par cas)
3. [classement]            → travail/classement/lot-N.json  (famille, symptôme, preuve)
4. construire-corpus.mjs   → cas/<id>.json + classement.json + familles-nouvelles.json
5. mesurer-corpus.mjs      → travail/mesures/<id>.json puis --bilan
```

Tout passe par des clones (`clones/`), jamais par les dépôts d'origine : ils sont lus une fois,
au clonage, et plus jamais touchés. `clones/` et `travail/` ne sont pas publiés (ils contiennent
du code et des données de nos projets).

## Ce qu'est un cas

Un commit dont le message annonce une correction, qui touche du backend ou du câblage
(`convex/`, `app/api/`, `src/lib/`, `src/hooks/`, `server/`, `scripts/`), et dont le correctif
fait moins de 60 lignes : assez petit pour qu'on voie ce qui n'allait pas.

`cas/<id>.json` ne contient **aucun code de nos dépôts** au-delà de deux lignes de preuve
anonymisées. Il contient ce qu'il faut pour rejouer :

| champ | à quoi il sert |
|---|---|
| `commit_casse` / `commit_repare` | l'état AVANT (le parent) et l'état APRÈS |
| `fichiers`, `lignes_avant`, `symboles` | les ancres : où le correctif a frappé |
| `famille`, `symptome` | le classement, écrit en regardant le diff, jamais l'auditeur |
| `rejouer` | la commande `git worktree add` qui remet le dépôt dans l'état fautif |

## Les quatre niveaux de la mesure

Les trois premiers sont ceux du banc figé (`banc/mesure/lib/appariement.mjs`, réutilisé tel quel
pour que les chiffres soient comparables) :

- **LOCALISATION** : un signalement nomme le fichier fautif.
- **PRÉCIS** : + le symbole touché, ou une ligne à ±12 de la ligne corrigée.
- **DIAGNOSTIC** : + la famille de la règle qui parle est celle du défaut.
- **DISPARITION** : le signalement précis n'est plus là après le correctif humain.

Le quatrième est le seul qu'un banc maison ne sait pas produire : un détecteur qui crie sur tout
obtient un rappel parfait sur des défauts plantés, et échoue ici, parce que le correctif humain
ne le fait pas taire.

## Rejouer

```bash
node banc/corpus/mesurer-corpus.mjs --echantillon=50 --graine=20260912   # l'échantillon publié
node banc/corpus/mesurer-corpus.mjs --tout --part=1/6                    # une part, pour paralléliser
node banc/corpus/mesurer-corpus.mjs --bilan                              # les chiffres
```

Refaire le corpus de zéro suppose les clones. Ils ne vivent PAS dans le skill : un dossier
de skill au-dessus de 8 Mo est refusé par le linter, et ces clones contiennent notre code.
Ils vont dans l'atelier, à côté du skill (`../scan-backend-frontend-archives/corpus/`, ou
le chemin de `CORPUS_ATELIER`) : c'est `banc/corpus/atelier.mjs` qui le décide, un seul
endroit à changer. Ci-dessous, `$ATELIER` désigne ce dossier.

```bash
ATELIER=$(node --input-type=module -e "import {ATELIER} from './banc/corpus/atelier.mjs'; console.log(ATELIER)")
git clone --shared --no-checkout /root/QOS $ATELIER/clones/qos
mkdir -p $ATELIER/clones/brvndlab
cp -r /home/hermes/workspace/brvndlab/.git $ATELIER/clones/brvndlab/.git   # « dubious ownership » : git refuse de cloner ce dépôt (autre propriétaire), la copie du .git contourne sans rien écrire chez lui
node banc/corpus/moissonner-corpus.mjs && node banc/corpus/dossiers.mjs
```

Pour paralléliser la mesure, un clone par processus (deux `git worktree add` simultanés sur le
même dépôt se disputent le verrou) :

```bash
cd $ATELIER/clones && for i in 1 2 3 4 5 6; do
  git clone --shared --no-checkout -q qos qos-p$i && git clone --shared --no-checkout -q brvndlab brvndlab-p$i
done
# puis, depuis la racine du skill :
for i in 1 2 3 4 5 6; do CORPUS_SUFFIXE=-p$i node banc/corpus/mesurer-corpus.mjs --tout --part=$i/6 & done
```

`--symboles-stricts` écarte les symboles d'ancrage sans pouvoir discriminant (`string`,
`undefined`, `Promise`) : la mesure du 12/09/2026 a été publiée SANS ce filtre (PRÉCIS 66,4 %) ;
avec, elle vaut 54,3 %. L'option existe pour que les deux chiffres restent reproductibles.

## Anonymisation

`anonymiser.mjs` passe sur chaque fiche : courriels, téléphones, secrets, et une liste de noms
tenue à la main (les fournisseurs — Convex, Clerk, Nango — restent lisibles, ce sont des
informations techniques). `construire-corpus.mjs` refuse silencieusement de mentir : il relit
chaque fiche produite et signale ce qui reste. Contrôle final avant livraison :

```bash
grep -rniE "(CLIENT_NAME|@[a-z0-9-]+\.(com|fr|ch))" banc/corpus/cas/ | head
```

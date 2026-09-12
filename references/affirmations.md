# Ce que tu rends quand tu as fini : des affirmations, pas de la prose

Tu viens de parcourir des écrans. Ne rends pas « le bouton Enregistrer ne sauvegarde
pas » : personne ne peut vérifier cette phrase, et si tu t'es trompé, ton erreur devient
notre constat. C'est arrivé : un agent a déclaré mort quatre fois un bouton
« Aujourd'hui » qui marchait, un autre a compté six boutons enfants d'un lien comme morts.

Tu rends un **lot d'affirmations typées**. Chacune porte exactement les champs qui
permettent de la rejouer. `verifier-affirmation.mjs` les rejoue une par une, sans LLM,
et rend pour chacune une de ces quatre dispositions : **confirmée**, **infirmée**,
**invérifiable**, **hors-sujet**. Il n'y a pas de « probablement vrai ».

Sous 70 % de confirmation sur ce qui a été tranché, ton lot est **REJETÉ** et tu refais.
Sous 50 % de lot jugeable aussi : vingt affirmations invérifiables ne sont pas un rapport.

> ⚠️ **Où mettre ce lot quand tu es un agent de parcours.** Ne rends pas un lot séparé :
> personne ne le lira. Ton rapport va dans `<repo>/.backend/parcours/<ton-groupe>.json`, et
> chaque anomalie y porte **une** affirmation dans son champ `affirmation`, avec exactement
> les champs décrits ici. C'est ce dossier que `parcours.mjs` rejoue et que `bilan.mjs`
> lit. Le format complet de l'enveloppe : `references/parcours-reel.md`.

## Le format exact

Un fichier JSON. Rien d'autre.

```json
{
  "agent": "parcours 2 — calendrier, intégrations, paramètres",
  "affirmations": [
    { "id": "A1", "type": "…", "dit": "…", "…champs du type…": "…" }
  ]
}
```

- `id` : court, à toi. Il sert à te relire.
- `type` : un des types du catalogue, à la lettre. `node scripts/affirmations.mjs` les liste.
- `dit` : ta phrase en français. Elle n'est jamais vérifiée, elle sert à l'humain qui lit.
- puis les champs du type, tels que le catalogue les nomme.

Relis-toi avant de rendre : `node scripts/affirmations.mjs --valider mon-lot.json`
te dit si la forme tient, sans rien vérifier du fond.

## Deux exemples complets

Un constat de code et un constat d'écran, tels qu'ils doivent sortir de ta main.

```json
{
  "agent": "parcours 2 — paramètres",
  "affirmations": [
    {
      "id": "A1",
      "type": "valeur_en_dur",
      "url": "/modules/parametres",
      "texte": "Sophie",
      "dit": "Le prénom du profil ne vient pas de la base : l'écran Paramètres affiche Sophie en dur alors que le compte est Jean Dupont."
    },
    {
      "id": "A2",
      "type": "fichier_contient",
      "chemin": "app/modules/parametres/page.tsx",
      "motif": "defaultValue=\"Sophie\"",
      "dit": "Et voici l'endroit exact dans le code."
    }
  ]
}
```

Les deux sont revenues **confirmées** : la première parce que « Sophie » survit à la
coupure de la source, la seconde parce que le motif est bien à la ligne 224.

À l'inverse, celle-ci est revenue **infirmée**, et c'est tout l'intérêt :

```json
{
  "id": "A3",
  "type": "bouton_sans_effet",
  "url": "/modules/calendrier",
  "libelle": "Aujourd'hui",
  "dit": "Le bouton Aujourd'hui du calendrier est mort : j'ai cliqué, rien ne bouge."
}
```

Le vérificateur a cliqué, n'a rien vu bouger — puis il a fait la contre-épreuve : il a
reculé d'un mois, re-cliqué, et l'écran est revenu à septembre. Le bouton marche.
L'agent avait raison sur ce qu'il a **vu**, et tort sur ce qu'il en a **conclu**.

## Les types, en une ligne chacun

Le catalogue qui fait foi est celui du code, jamais cette page : `node scripts/affirmations.mjs`
les liste avec leurs champs, les seuils et la façon dont chacun est tranché.

**Écran** (il faut l'application allumée)

| type | champs | ce qu'il affirme |
|---|---|---|
| `bouton_ne_persiste_pas` | url, libelle, champ | on enregistre, on recharge, la valeur d'avant est revenue |
| `bouton_sans_effet` | url, libelle | on clique et rien ne se passe, contre-épreuve comprise |
| `valeur_en_dur` | url, texte | la valeur survit à la coupure de la source |
| `compteur_faux` | url, affiche, selecteur, compte | le nombre annoncé ne correspond pas à ce qu'on compte |
| `page_inatteignable` | url | l'adresse ne mène pas à un écran du produit |
| `texte_present` | url, texte | ce texte est lisible à l'écran (texte ou champ) |
| `texte_absent` | url, texte | ce texte n'est nulle part à l'écran |
| `element_hors_ecran` | url, selecteur, largeur | l'élément sort de la fenêtre et pousse la page |

**Réseau**

| type | champs | ce qu'il affirme |
|---|---|---|
| `requete_en_echec` | url, statut | cette adresse répond en échec, avec ce statut |
| `lien_mort` | href, statut | ce lien, suivi jusqu'au bout, arrive sur une page morte |

**Code**

| type | champs | ce qu'il affirme |
|---|---|---|
| `fichier_contient` | chemin, motif | ce motif est dans ce fichier |
| `fichier_ne_contient_pas` | chemin, motif | ce motif n'y est pas |
| `symbole_appele` | nom, appels_attendus | ce symbole est appelé N fois (0 = code mort) |
| `route_existe` | route | un fichier sert bien cette route |

`motif` accepte du texte littéral, ou `/expression/drapeaux` pour une expression régulière.

## Sept règles qui t'évitent un lot rejeté

1. **Un constat, une affirmation.** « Six boutons sont morts » n'est pas une affirmation,
   c'est six. Chacune se trompe ou tient toute seule.
2. **Double ton constat d'écran par un constat de code** quand tu peux (les exemples A1 et
   A2 plus haut). Deux types qui tombent d'accord, c'est une preuve ; un seul, un indice.
3. **Ce que tu n'as pas pu vérifier, tu ne l'affirmes pas.** Une affirmation invérifiable
   compte contre toi dans le taux de jugeabilité. Si l'écran n'a pas chargé, dis-le dans
   ta prose, n'invente pas une affirmation typée dessus.
4. **N'affirme jamais un bouton mort sans avoir changé l'état de l'écran d'abord.**
   « Aujourd'hui » quand on est déjà aujourd'hui ne bouge pas, et il n'est pas mort.
   Le vérificateur refait la contre-épreuve de toute façon : autant ne pas t'y brûler.
5. **Un bouton dans un lien n'est pas un bouton mort.** C'est le parent qui reçoit le clic.
   Le vérificateur infirme ces affirmations-là sans appel.
6. **Un compteur sur un écran paginé n'est pas un compteur faux.** « 1–50 sur 7 885 » est
   la réponse à ta question, pas le défaut. Ces affirmations reviennent hors-sujet.
7. **Un numéro de ligne n'est pas un motif.** `"motif": "306"` revient hors-sujet.
   Recopie le texte, pas la position.

## Ce que le vérificateur ne fera jamais

Il ne clique pas ce qui supprime, vide, archive, réinitialise ou déconnecte : jamais,
même avec une option. Il ne clique pas ce qui écrit (enregistrer, créer, nouveau,
ajouter, envoyer, importer) sans `--ecriture-permise`, qui ne se donne que sur une base
de test. Il n'appelle aucune adresse hors du produit. Et il ne modifie rien dans le
dépôt audité.

Donc : si ton constat porte sur un bouton qui écrit, écris quand même l'affirmation
`bouton_ne_persiste_pas` en bonne et due forme. Elle reviendra **invérifiable** avec la
raison « écriture non consentie », et c'est un résultat honnête qu'un humain pourra
reprendre à la main. Ce n'est pas une faute de ta part, et ça ne compte pas comme une
erreur dans ton taux de confirmation.

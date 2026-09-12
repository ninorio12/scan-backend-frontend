# Entrer dans la maison : le parcours réel

Le scan lit les plans. Ici on ouvre les portes et on appuie sur les interrupteurs.

**Pourquoi ce fichier existe.** Le 11/09/2026, sur projet client A, l'analyse statique sortait une
poignée de constats. Cinq agents lâchés dans l'application avec un navigateur en ont
sorti **une soixantaine de défauts réels en deux heures**, dont aucun n'était visible
dans le code. Le 12/09/2026, sur un projet public, six agents ont trouvé **les dix défauts
les plus graves du produit** : un écran qui donne trois réponses différentes à la même
question, un badge « live » vert par défaut quand rien n'est branché, une croissance
calculée sur des données de 92 jours sans qu'aucune date ne soit affichée, une barre
latérale qui laisse 176 px de vide une fois repliée. **C'est l'étape qui rapporte le plus,
de loin** — et ce jour-là, aucun de ces dix défauts n'est entré dans le bilan, parce que
rien ne lisait les rapports des agents. C'est réglé : voir « Le rendu » plus bas.

Le même jour, cinq agents ont démenti les **256 « boutons morts »** du passage mécanique
(fenêtre d'attente trop courte sur un serveur de dev qui met de 0,07 s à 42 s à rendre une
page) : 228 de ces constats portaient sur 21 libellés que ces agents ont rejoués et vus
fonctionner. Après contre-épreuve, **189 sont sortis du bilan, 67 y sont restés, et 6
démentis n'ont pas tenu**. Donc ça marche dans les deux sens, et dans les deux sens la
parole ne suffit pas : **tout ce qui entre au bilan passe par `verifier-affirmation.mjs`**.

---

> 📌 Le 11/09, cinq agents ont écrit une centaine de scripts Playwright à la main alors
> que ces trois skills étaient installés (ou à une commande). **Chercher dans le registre
> avant d'écrire** : `npx skills find "<besoin>"`. Ça vaut pour chaque étape.

## La procédure, dans l'ordre

| | |
|---|---|
| 1 | Les quatre vérifications, et le voile |
| 2 | Le découpage : **trois agents à la fois**, jamais plus de six groupes |
| 3 | Le brief, à recopier tel quel |
| 4 | Le rendu : `<repo>/.backend/parcours/<groupe>.json`, format imposé |
| 5 | La vérification : `parcours.mjs --verifier`, puis `bilan.mjs` |
| 6 | Ce qu'on fait d'un groupe qui ne rend pas |

---

## 1 · Avant de lancer quoi que ce soit

```bash
ss -ltnp | grep -E ':(3000|3001|5173)'        # l'app tourne-t-elle déjà ?
grep -E 'CONVEX_DEPLOYMENT|DATABASE_URL' <repo>/.env.local | sed 's/=.*:/=…:/'
ls <repo>/app/modules/ 2>/dev/null || ls <repo>/app/           # les modules
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```

1. **L'application tourne-t-elle ?** Sinon la lancer (`npm run dev`) et attendre.
2. **Sur quelle base tape-t-elle ?** `dev` : on peut cliquer. `prod` : **on ne clique
   rien**, on se contente d'observer en lecture. Un déploiement `dev` peut quand même
   contenir les vraies données du client (c'était le cas d'projet client A, 7 885 contacts réels).
3. **Y a-t-il une authentification ?** Si oui, il faut une session enregistrée
   (`storageState` Playwright), sinon les agents testeront la page de connexion et
   concluront que tout va bien — un blanc-seing, pire que rien.
4. **Quels sont les modules ?** C'est le découpage des périmètres.

**Et le voile.** Avant de découper, ouvrir l'accueil et regarder ce qui recouvre l'écran :
modale de bienvenue, panneau latéral, bandeau de consentement. Le 12/09, une modale
`fixed inset-0 z-[150]` a réduit le passage mécanique de la page d'accueil à **1 bouton
cliqué sur 95, en 898 secondes** : le travailleur ne savait pas la fermer et s'obstinait.
Trouver la parade UNE fois et la donner à tous les agents dans le brief : la croix, Échap,
ou la clé de stockage local que pose l'application (`localStorage['…-invite']='seen'`,
posée avec `addInitScript` avant le premier rendu). Même chose pour un panneau fermé dont
les commandes sont `pointer-events: none` tant qu'il l'est : il faut l'**ouvrir** d'abord,
sinon ses boutons remontent en « recouvert par un autre élément ».

---

## 2 · Le découpage : trois agents à la fois, et la borne est dure

Trois modules par agent environ, groupés par nature (les tableaux de bord ensemble, le
métier ensemble, les branchements ensemble). **Les périmètres doivent être disjoints** :
deux agents sur la même application écrivent dans la même base et leurs traces se
mélangent — c'est arrivé, un agent a lu dans le journal des écritures d'un autre et a
failli les compter comme des défauts. Dire à chaque agent que d'autres travaillent en
parallèle.

**Trois agents en parallèle par défaut, six au grand maximum, et jamais six sur un serveur
de développement.** Ce n'est pas une préférence, c'est une mesure : le 12/09, six agents
Playwright sur un serveur Next en mode dev ont fait monter la charge à **7,9 sur 4 cœurs**,
`/funnel` mettait **27 secondes** à répondre, et le serveur a **redémarré tout seul**
(≈1 Go de RSS, nouveau PID) au milieu du travail. Un agent a dû rejouer la moitié de sa
campagne serveur libre avant de conclure. La lenteur ne fait pas que coûter du temps :
elle **fabrique de faux défauts**, puisqu'un bouton qu'on n'attend pas assez passe pour
mort. Plus de groupes que de places : on les lance par vagues de trois.

Toujours réserver un agent au groupe **calendrier / intégrations / paramètres** : c'est
là que se concentrent les défauts de câblage dans tous nos produits.

Écrire le découpage AVANT de lancer, dans `<repo>/.backend/parcours/groupes.json` :

```json
{
  "application": "http://localhost:3000",
  "paralleles": 3,
  "groupes": [
    { "groupe": "g1-tableaux", "ecrans": ["/", "/analytics", "/doctor"] },
    { "groupe": "g2-metier",   "ecrans": ["/funnel", "/finances", "/tasks"] }
  ]
}
```

Ce fichier est ce qui rend un absent visible : un groupe listé ici et qui ne rend jamais
sort **nommément** en « non regardé » dans le bilan, avec ses écrans. Sans lui, personne
ne sait ce qui manque.

---

## 3 · Le brief, à recopier et adapter

> Tu testes une vraie application en cliquant dedans, comme le ferait un utilisateur
> méfiant. Tu travailles en français.
>
> TON PÉRIMÈTRE, et rien d'autre : les modules **X, Y, Z** de l'application `<NOM>`, qui
> tourne sur http://localhost:3000. Tes URL : …
> D'autres agents travaillent en parallèle sur d'autres modules : ne sors pas du tien.
>
> ⚠️ TROIS INTERDITS ABSOLUS
> 1. Ne modifie AUCUN fichier du projet. Tu observes, tu ne répares pas.
> 2. Ne clique JAMAIS sur un bouton destructeur : supprimer, archiver, vider,
>    réinitialiser, purger, désactiver, déconnecter. Ni sur ce qui écrit chez un tiers
>    (créer un contact qui part dans le CRM du client, envoyer un message, publier).
>    La base contient les vraies données du client. Tout le reste se clique.
> 3. Ne laisse RIEN tourner derrière toi. Pas de boucle d'attente, pas de guetteur, pas
>    de `watch`, pas de `tail -f`, pas de serveur lancé par toi. Avant de rendre la main :
>    tue ce que tu as lancé et dis-le. Le 12/09, un agent a laissé des boucles d'attente
>    qui ont renvoyé **une douzaine de notifications de fin identiques**.
>    ⚠️ Et le piège qui fabrique ces guetteurs : `pgrep -f "<motif>"` **te trouve toi**,
>    parce que ta propre ligne de commande (et celle du shell qui t'a lancé) contient le
>    motif que tu cherches. Tu attends alors une chose qui ne finira jamais. Deux agents
>    sont tombés dedans la même nuit. Attends un **fichier** :
>    `until [ -f resultat.json ]; do sleep 2; done`. Ou, si tu tiens à attendre un
>    processus, attends **un PID que tu as noté**, jamais un motif :
>    `P=$!` puis `while kill -0 $P 2>/dev/null; do sleep 2; done`. Vérifié le 12/09 :
>    ni `[m]otif` entre crochets ni `grep -v $$` ne sauvent, puisque ce n'est pas le
>    `grep` qui matche, c'est la ligne de commande de ton propre lanceur.
>
> LE VOILE, s'il y en a un : `<la parade, trouvée une fois pour toutes>`. Ferme-le AVANT
> de recenser, sinon tu compteras des boutons « recouverts » qui ne le sont pas.
>
> **Ne réécris pas un pilote de navigateur à la main**, trois skills installés font le
> travail : `playwright-cli` (Microsoft) pilote le navigateur en ligne de commande sans
> écrire de script (`playwright-cli open <url>`, puis `click e15`, `fill e5 "texte"`,
> `snapshot` qui donne les références de chaque élément) ; `webapp-testing` (Anthropic)
> apporte `with_server.py` qui lance et arrête le serveur tout seul, et le motif
> **reconnaissance puis action** ; `browser-testing-with-devtools` (Osmani) pour la
> console, le réseau et le profilage. Playwright brut reste disponible pour ce qu'ils ne
> couvrent pas : l'interception réseau fine et la coupure de source. ⚠️ Playwright n'est
> peut-être installé QUE dans le dossier du skill : un script posé ailleurs meurt en
> `ERR_MODULE_NOT_FOUND`. Lance tes scripts depuis le dossier qui contient
> `node_modules/playwright`, ou passe par `scripts/navigateur.mjs` qui le trouve seul.
>
> ⚠️ ATTENDS. `wait_for_load_state('networkidle')` avant toute observation, et **au moins
> 10 secondes** après un clic qui peut naviguer, sur un serveur de développement. Un
> serveur Next en dev compile à la volée : mesuré le 12/09, de 0,07 s à 42 s pour la même
> page, médiane 4,3 s. Un agent qui n'attendait que 1,3 s a relevé « une vingtaine de faux
> boutons morts » et l'a reconnu. **Un bouton déclaré mort sans attente longue n'est pas un
> constat, c'est une erreur de mesure.**
>
> CE QUE TU CHERCHES, par ordre d'importance :
> 1. **Un bouton qui ment.** La preuve n'est jamais le message affiché : tu cliques, tu
>    RECHARGES la page, et tu regardes si le changement a survécu.
> 2. **Une valeur inventée.** Bloque la source et recharge : ce qui reste affiché est
>    écrit en dur. Sur Convex, l'interception HTTP ne coupe pas le WebSocket : couper au
>    niveau DNS. ⚠️ Si les pages sont rendues côté serveur (`force-dynamic`, base locale),
>    couper `**/api/**` ne prouve RIEN : tout le contenu reste. Dis-le au lieu de conclure.
> 3. **Un chiffre qui ne tient pas.** Tout nombre affiché doit se retrouver dans la liste
>    en dessous, ou dans l'écran vers lequel il pointe. Compte les lignes et compare.
> 4. **Deux endroits qui répondent différemment à la même question** sur le même écran.
> 5. **Un chiffre sans sa date** : « 7 derniers jours » sur des données de trois mois.
> 6. **Un appel réseau cassé** : chaque 404, 500, réponse vide.
> 7. **Un lien vers une page qui n'existe pas.**
> 8. **Un bouton mort** : clic sans requête, sans changement, sans erreur — après attente
>    longue et contre-épreuve.
> 9. **Un écran qui ne sait pas dire qu'il est vide ou en panne** : page blanche,
>    squelette infini, zéro silencieux. Un « 0 » à la place de « serveur injoignable »
>    est un défaut grave : le client prend une décision sur un chiffre faux.
> 10. **Un réglage qui ne survit pas au rechargement.**
>
> MÉTHODE : énumère TOUS les éléments cliquables, clique chacun sauf les destructeurs, et
> dis combien il y en avait et combien tu en as cliqué. Pour chaque anomalie : l'URL, le
> libellé exact, ce que tu attendais, ce qui s'est passé, la preuve. **N'affirme jamais
> qu'une chose est cassée sans l'avoir provoquée deux fois.**
>
> ÉCHANTILLONNER EST PERMIS, LE CACHER NE L'EST PAS. Devant un écran qui répète le même
> élément (86 lignes d'annuaire identiques), teste un échantillon, écris combien tu as
> testé sur combien, et mets le reste en `non_testes` avec la raison. Le 12/09 un agent a
> rendu « 136 recensés, 26 cliqués, 104 non testés » : c'est un bon rapport. « 136 sur
> 136 » aurait été un mensonge.
>
> HONNÊTETÉ : « non testé » est une réponse acceptable, « ça a l'air de marcher » sans
> clic ne l'est pas. Dis aussi ce qui marche, vérifié par rechargement. Si tu laisses une
> donnée de test en base, signale-la nommément dans `traces` pour qu'on la retire.
>
> TON RENDU, et il est obligatoire : le fichier JSON décrit ci-dessous, écrit dans
> `<repo>/.backend/parcours/<ton-groupe>.json`. Tes scripts et tes captures vont où tu
> veux (`<skill>/banc/parcours/<ton-groupe>/` est persistant), mais **le rapport va là,
> dans ce format**. Un rapport hors format n'entre pas dans le bilan, et ton travail est
> perdu. Relis-toi avec `node scripts/parcours.mjs <repo>` : il te dit ce qui manque.

Quand l'analyse statique a déjà trouvé des choses dans ce périmètre, **les donner à
l'agent** en lui demandant de les confirmer ou de les infirmer en vrai, et de rendre ses
démentis dans `dementis`. Un défaut du code qui ne se voit pas à l'écran est moins grave
qu'un défaut qui se voit, et un démenti nous apprend que notre lecture se trompe. Sur
projet client A : 4 annoncés, 4 confirmés, 13 trouvés en plus. Le 12/09 : 228 « boutons
morts » sur 256 démentis, et ils avaient raison.

---

## 4 · Le rendu : `<repo>/.backend/parcours/<groupe>.json`

Un fichier par groupe. C'est le seul canal : `bilan.mjs` lit ce dossier, et rien d'autre
de ce que l'agent produit n'entre dans le rapport.

```json
{
  "groupe": "g1-tableaux",
  "agent": "parcours 1 — accueil, analytics, doctor",
  "ecrans": ["/", "/analytics", "/doctor"],
  "rendu": "2026-09-12T11:52:00+02:00",
  "guetteurs_nettoyes": true,

  "decompte": [
    { "ecran": "/", "recenses": 93, "cliques": 90, "ecartes": 1,
      "non_testes": 2, "non_concluants": 0,
      "pourquoi": "1 écarté « Send » (verbe d'écriture) ; 2 dans le panneau fermé" }
  ],

  "anomalies": [
    { "id": "G1-1",
      "gravite": "trompe",
      "famille": "badge « live » en dur",
      "ecran": "/doctor",
      "quoi": "« ZeroEntropy · LIVE » s'affiche en vert alors que l'écran n'a aucune information de santé",
      "preuve": "app/doctor/page.tsx:128 — sans information, la valeur affichée est 'LIVE'",
      "affirmation": { "type": "fichier_contient", "chemin": "app/doctor/page.tsx", "motif": "… : 'LIVE'" } }
  ],

  "dementis": [
    { "id": "G1-D1",
      "cible": { "famille": "bouton mort", "libelle": "Home" },
      "pourquoi": "18 liens rejoués sur 3 écrans : 18/18 naviguent, délais 0,07 s à 25 s",
      "affirmation": { "type": "bouton_sans_effet", "url": "/analytics", "libelle": "Home" },
      "tient_si": "infirmée" }
  ],

  "traces": ["contact « Test Dupont » créé dans crm_contacts, à retirer"]
}
```

**Les champs, un par un.**

| champ | obligatoire | ce qu'il porte |
|---|---|---|
| `groupe` | oui | le nom du groupe, celui du manifeste et du fichier |
| `ecrans` | oui | les URL de ton périmètre |
| `decompte` | oui | une ligne par écran. Sans lui, ton rapport n'est **pas fini** |
| `decompte[].recenses` / `cliques` | oui | combien d'éléments cliquables, combien cliqués |
| `decompte[].ecartes` | — | volontairement pas cliqués (écrit, détruit, externe) |
| `decompte[].non_testes` | — | voulus et pas atteints, ou échantillonnés : ce n'est **pas** un OK |
| `decompte[].non_concluants` | — | cliqués sans pouvoir conclure (clic en échec, écran instable) |
| `decompte[].pourquoi` | — | la phrase qui nomme les écartés et les non testés |
| `anomalies[].gravite` | oui | `trompe`, `cassé` ou `dette`. La même échelle que tout le skill |
| `anomalies[].famille` | — | le nom de la famille sous laquelle le bilan la range |
| `anomalies[].quoi` / `preuve` | oui / — | la phrase, et de quoi la rejouer |
| `anomalies[].affirmation` | — | une affirmation typée : voir `references/affirmations.md` |
| `dementis[].cible` | oui | `famille` + `libelle` (et/ou `ecran`, `ou`) du constat mécanique visé |
| `dementis[].tient_si` | — | la disposition qui fait tenir le démenti, `infirmée` par défaut |
| `traces` | — | les données de test que tu laisses en base, nommément |
| `guetteurs_nettoyes` | — | `true` quand tu n'as rien laissé tourner |

**Ce qui décide de l'entrée au bilan**, et ce n'est pas négociable :

| ce que le vérificateur dit de ton affirmation | ce que devient ton constat |
|---|---|
| confirmée | il entre, marqué **confirmé par contre-épreuve** |
| invérifiable / hors-sujet | il entre, **avec la mention et la raison** |
| infirmée | il **n'entre pas**, et il est listé comme écarté |
| pas d'affirmation du tout | il entre en **« rapporté, non vérifié »** — jamais en confirmé |

Un **démenti** suit la règle inverse et plus dure : il ne retire un constat mécanique que
s'il a été **rejoué et qu'il tient**. Un démenti sans affirmation ne retire rien. Une
mesure ne se retire pas sur parole.

Le taux de confirmation par groupe est calculé et affiché : c'est la note de ton lot.

---

## 5 · La vérification, puis le bilan

```bash
node scripts/parcours.mjs <repo>                                   # relire la forme, voir les manques
node scripts/parcours.mjs <repo> --verifier --base http://localhost:3000 --attente 15000
node scripts/bilan.mjs <repo>
```

`--verifier` rejoue chaque affirmation avec `verifier-affirmation.mjs` (sans LLM, sans
réseau sortant) et écrit `<groupe>.verifie.json` à côté du rapport. `couverture.mjs` fait
les deux tout seul quand l'application répond. `--attente` est la patience accordée à
chaque clic : sur un serveur de développement, la monter à 10-15 secondes.

---

## 6 · Un groupe qui ne rend pas

Le 12/09, un groupe sur six n'est jamais revenu : lancé à 11:03, il écrivait encore des
fichiers à 12:44, on lui a redemandé son rapport par écrit à 13:02, et à 13:46 il n'avait
toujours rien rendu. Trois modules du produit n'ont eu que le passage mécanique. Voici la
conduite à tenir, faute de quoi chacun improvise :

1. **Délai.** Au-delà de **90 minutes** sans rapport, on relance l'agent une fois, par
   écrit, en lui demandant de rendre **ce qu'il a**, avec son décompte, en assumant ce
   qui n'a pas été fait. Un rapport partiel bien compté vaut mieux que rien.
2. **Deuxième délai.** **30 minutes** de plus, et on le considère perdu.
3. **On récupère ce qu'on peut.** Ses fichiers de travail sont là : un décompte
   reconstitué à partir de ses JSON, avec la mention « reconstitué », vaut mieux qu'un
   trou. On n'invente rien : ce qu'on ne peut pas reconstituer reste en `non_testes`.
4. **On ne maquille pas.** Le groupe reste dans `groupes.json`. Sans rapport, il sort en
   « non regardé » avec ses écrans, le bilan reste INCONNU, et c'est exactement ce qu'il
   faut : trois modules n'ont pas eu de passage agent, et ça doit se voir.
5. **On le relance plus tard**, sur le même périmètre, quand une place se libère.

---

## La base non Convex : le format de l'export

`npx convex export` n'existe que sur Convex. Partout ailleurs, l'export se fabrique à la
main et se passe à la chaîne avec `--export <dossier>` :

```bash
node scripts/couverture.mjs <repo> --url http://localhost:3000 --export /tmp/export-base
node scripts/nettoyer-base.mjs <repo> --export /tmp/export-base      # le même, tout seul
```

**Le format attendu** : un **dossier**, un fichier **`.jsonl` par table**, nommé comme la
table, **une ligne = un document JSON**. `<table>/documents.jsonl` (la forme des exports
Convex) est accepté aussi. Rien d'autre n'est lu. Sans cet export, le bilan écrit
« base non inspectée : fournir --export » et **ne dit rien d'autre sur la base** : pas de
chiffre, pas de « rien à signaler ».

**SQLite**, avec le client en ligne de commande :

```bash
mkdir -p /tmp/export-base
for t in $(sqlite3 base.db "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); do
  sqlite3 -readonly -json base.db "SELECT * FROM \"$t\";" | jq -c '.[]' > /tmp/export-base/$t.jsonl
done
```

**SQLite sans le client en ligne de commande** (c'est le cas le plus fréquent : le projet
a `better-sqlite3` dans ses dépendances, la machine n'a pas `sqlite3`). À lancer **depuis
le dossier du projet audité**, pour que `require` trouve son pilote. `readonly: true` :
rien n'est écrit, et les empreintes MD5 des fichiers de base le prouvent après coup.

```bash
node -e "
const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const [fichier,sortie]=process.argv.slice(1);
const db=new Database(fichier,{readonly:true,fileMustExist:true});
fs.mkdirSync(sortie,{recursive:true});
for(const {name} of db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all()){
  const l=db.prepare('SELECT * FROM \"'+name+'\"').all();
  fs.writeFileSync(path.join(sortie,name+'.jsonl'),l.map(x=>JSON.stringify(x)).join('\n')+'\n');
}
" data/base.db /tmp/export-base
```

Un projet à plusieurs fichiers `.db` : lancer la commande une fois par fichier, vers le
**même** dossier de sortie. Mesuré le 12/09 sur trois fichiers SQLite : 31 tables,
1 201 documents, 115 documents semés retrouvés dans 19 tables, empreintes des bases
inchangées.

**Postgres** :

```bash
mkdir -p /tmp/export-base
for t in $(psql "$DATABASE_URL" -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public'"); do
  psql "$DATABASE_URL" -At -c "COPY (SELECT row_to_json(x) FROM \"$t\" x) TO STDOUT" > /tmp/export-base/$t.jsonl
done
```

Dans tous les cas : **l'export sort du dépôt** (`/tmp`, jamais `.backend/`), il se lit en
lecture seule, et il se supprime après. Il contient les vraies données du client.

---

## Ce qui revient dans tous nos produits, à chercher en premier

1. **Des données de démonstration dans la vraie base.** Cause racine n°1 sur projet client A,
   trouvée indépendamment par quatre agents. Elle produit les pires symptômes : un agenda
   de personnes fictives, et surtout une recherche qui échoue et ouvre « la première
   fiche de la liste » sans le dire, c'est-à-dire une vraie cliente.
2. **Un écran qui affiche 0 au lieu de dire qu'il est en panne.**
3. **Un compteur qui compte autre chose que ce qu'il annonce** (des archives comptées
   comme des ventes, des loyers additionnés à des prix de vente, des « pas propriétaire »
   comptés comme propriétaires).
4. **Un réglage enregistré dans le navigateur et jamais en base** — ou écrit puis écrasé
   par son propre effet de montage : quatre agents l'ont trouvé le 12/09, une seule cause.
5. **Un chiffre cliquable qui ne mène pas à son décompte.**
6. **Un état « actif » démenti par la source que la page appelle elle-même.**

---

## Après : la consolidation

`bilan.mjs` fait l'entrée au rapport. Reste ce qu'aucune machine ne fait :

**Remonter la cause racine avant les symptômes.** Sur projet client A, une seule cause (les
données de démonstration) expliquait à elle seule une dizaine de constats répartis dans
quatre modules. Le 12/09, « Collapse sidebar » a été trouvé par quatre groupes : c'est un
défaut, pas quatre, et la cause est une ligne de `Sidebar.tsx`.

**Nettoyer les traces** : les agents laissent des données de test qu'ils n'ont pas le
droit de supprimer. Elles sont listées dans `traces`, le bilan les reprend nommément, et
la suppression se décide devant la liste, avec quelqu'un qui connaît le métier.

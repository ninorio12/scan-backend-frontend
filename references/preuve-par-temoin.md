# La preuve par témoin

La seule méthode qui prouve qu'un écran affiche bien la donnée de la source, sur tout un
SaaS, quelle que soit la stack, sans connaître les bugs à l'avance.

## Le principe

On écrit dans la base, pour le compte de test, des valeurs **reconnaissables entre
mille** : `ZQXprenom`, `zqxemail@temoin.test`, `424242`. Puis on parcourt l'application.

Tout ce qui ressemble à une donnée à l'écran et qui ne porte pas le marqueur n'est pas
câblé à la source. Pas d'interprétation, pas de jugement : ou c'est un témoin, ou ce n'est
pas relié.

C'est exhaustif par construction, là où l'analyse statique est une liste de motifs connus.
Elle attrape `defaultValue="Sophie"` ; elle ne verra jamais un champ branché sur la
mauvaise source, un montant calculé à partir d'une constante, ou un écran qui affiche le
profil d'un autre compte. Le témoin attrape les trois.

## Le protocole

```bash
# SKILL = le dossier du skill, où qu'il soit installé (celui qui contient package.json)
SKILL=/chemin/vers/scan-backend-frontend
T=$SKILL/scripts/temoins.mjs

# 1. Obtenir le jeu de valeurs
node $T generer

# 2. Les écrire en base PAR LA VOIE NORMALE du produit (mutation, seed, formulaire),
#    jamais en modifiant le code de l'écran à tester.

# 3. Parcourir l'application avec le compte de test, sauvegarder le HTML de chaque écran

# 4. Vérifier
node $T verifier ecran-parametres.html
node $T verifier ecran-fiche-client.html --json
```

Le pilotage du navigateur se fait avec ce qu'on a déjà (`reticle`, `browser-harness`) :
ouvrir l'écran, récupérer le HTML, passer le fichier au vérificateur. Rien d'autre à
installer.

## Les deux règles qui rendent la preuve valable

**Écrire les témoins par la voie normale du produit.** Si on les insère à la main dans la
base en contournant les mutations, on ne teste plus que la lecture et on rate la moitié de
la chaîne. Le chemin d'écriture fait partie de ce qu'on prouve.

**Ne jamais adapter l'écran au test.** Le témoin n'est utile que s'il traverse le code tel
qu'il partira en production.

## Lire le résultat

- Valeur affichée **avec** le marqueur : le maillon 6 est relié, la chaîne tient.
- Valeur affichée **sans** le marqueur : donnée en dur, ou branchement sur la mauvaise
  source. Les deux sont des bugs, le second est le plus grave.
- **Aucune** valeur témoin sur un écran censé afficher les données du compte : soit
  l'écran ne lit rien, soit les témoins n'ont pas été écrits. Vérifier avant de conclure,
  l'outil le signale explicitement.

## Ce que le vérificateur regarde

Les valeurs de champs de saisie et de zones de texte, les emails, téléphones, montants et
dates. Volontairement pas les textes libres : un libellé d'interface (« Enregistrer », un
nom de colonne) n'est pas une donnée, et le signaler noierait le rapport.

## Quand le passer

Avant toute livraison d'un module qui affiche de la donnée, et systématiquement avant une
démo client. C'est dix minutes, et c'est la seule chose qui distingue un écran fini d'un
écran qui a l'air fini.

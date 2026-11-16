# Vision — ce que Thomas attend de l'appli

Écrit le 16/11/2026 à partir des mots de Thomas. Toute nouvelle fonctionnalité doit servir un de ces objectifs.
Les fonctionnalités s'ajouteront au fil du temps : ce fichier évolue.

## Objectifs
1. **Progresser fortement** en électricité, maths, physique, management, marketing et élocution.
2. **Gérer la planification pro et perso** : le débrief du soir prépare le brief du matin, les rendez-vous vont dans l'agenda de l'appli.
3. **Réagir vite aux imprévus** grâce à un arbre de décision qui s'enrichit.

## Ce que l'appli doit faire

### 1. Parler avec l'appli, chaque jour
S'entraîner à l'oral : donner des ordres, rendre compte, expliquer de façon concise.
Réviser à l'oral : maths, physique, électricité, références de matériel, fonctionnement du matériel utilisé.

### 2. Débrief du soir (onglet)
Thomas raconte : sa journée, les rendez-vous pris, ce qu'il doit faire demain…
L'appli analyse, **met les rendez-vous dans l'agenda**, et **demande si les outils et le matériel sont toujours au même endroit** (Thomas confirme ou donne les changements → la liste est mise à jour).
Elle prépare le brief du lendemain : quoi faire, comment le faire, en passant par l'arbre de décision.

### 3. Brief du matin (bouton « Démarrer le brief »)
- Rappel de ce qu'il faut faire et comment le faire.
- Une courte révision.
- Ce qu'il faut prendre : **avant de partir**, **à l'atelier**, **chez le fournisseur** si besoin.

### 4. Imprévu
Thomas dit ce qui arrive. L'appli compare avec ce qui était prévu et propose : des solutions adaptées, les ordres à modifier, le compte rendu à modifier.

### 5. Outils et matériel (bouton)
Inventaire des outils et du matériel **avec l'endroit où chacun se trouve**. Mis à jour au débrief du soir.

### 6. Révision (bouton)
Réviser et s'entraîner quand Thomas en a envie.

## État au 16/11/2026 (version 2 de l'appli)
| Attente | Existe ? | Ce qui manque |
|---|---|---|
| 1. Parler avec l'appli | En partie : le bouton « Parler » ouvre l'appli Claude (mode vocal) | Conversation **dans** l'appli : décision à prendre (voir plus bas) |
| Révision par matière | Électricité, management, marketing | Maths, physique, matériel (références, fonctionnement) |
| Élocution | Directives, compte rendu | Explication concise |
| 2. Débrief du soir | 8 questions + lieu et situation de demain | Question « RDV pris », « à faire demain », vérification des emplacements d'outils |
| RDV dans l'agenda | Oui, via Claude (boîte Drive) | — |
| 3. Brief du matin | Écran brief préparé par Claude | Bouton « Démarrer », mini-révision, listes « partir / atelier / fournisseur » |
| 4. Imprévu | Écran incident + arbre dans la base | Comparaison avec le prévu, ordres et compte rendu modifiés |
| 5. Outils et matériel | Inventaire, état, stock mini, commandes | **Emplacement** de chaque outil |
| 6. Révision libre | Oui | — |

## Décision ouverte : où se passe la conversation ?
- **Dans l'appli Claude (aujourd'hui)** : inclus dans l'abonnement, mode vocal déjà au point. Il faut changer d'appli puis synchroniser.
- **Dans l'appli de Thomas** : plus fluide, mais demande l'API Claude, payée à l'usage (en plus de l'abonnement), avec une clé sur le téléphone.

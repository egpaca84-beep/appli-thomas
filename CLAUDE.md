# Règles du projet — Appli chef d'équipe EG PACA

À lire au début de chaque session. Ces règles priment sur tout le reste.

## Méthode de travail
1. **Une seule tâche à la fois** : la première case non cochée de `docs/ROADMAP.md`. Rien d'autre.
2. **Avant de coder** : relire la tâche, son critère de fin et la partie concernée de `docs/ARCHITECTURE.md`. Si quelque chose est flou, poser la question à Thomas avant d'écrire du code.
3. **Pendant** : changer le minimum de fichiers possible. Pas de nouvelle bibliothèque sans l'accord de Thomas.
4. **Vérification obligatoire avant de cocher** :
   - `npm run check` passe (lint + tests), sans erreur ;
   - le critère de fin de la tâche est vérifié pour de vrai **sur le téléphone** (l'appli est faite pour lui ; le navigateur du PC ne suffit pas) ;
   - relecture de simplification : code mort, doublons, fonctions trop longues, noms flous → corriger.
5. **Ne jamais passer à la tâche suivante** si une vérification échoue. Corriger d'abord.
6. **Après** : cocher la tâche, noter la date et ce qui a changé dans le journal en bas de `docs/ROADMAP.md`, mettre à jour `docs/ARCHITECTURE.md` si la structure a changé.

## Règles de code
- JavaScript pur, sans framework ni étape de compilation : les fichiers sont servis tels quels par GitHub Pages.
- Une fonction de calcul (météo, nacelle, dates, stock, révision) = pas d'accès au DOM ni à `localStorage` → elle doit être testable dans `tests/`.
- Toute logique nouvelle ou modifiée a son test.
- Tout texte venant de l'utilisateur ou de Claude passe par `esc()` avant d'aller dans du HTML.
- Simplifier avant d'ajouter : si une fonctionnalité peut réutiliser l'existant, réutiliser.
- Un fichier ajouté au projet doit aussi être ajouté à la liste `SHELL` de `sw.js` (le test le vérifie).

## Sécurité et données
- Aucune clé, aucun identifiant, aucune donnée de chantier dans le code ni dans GitHub (dépôt public).
- La limite de vent de la nacelle vient de la notice : ne jamais mettre de valeur par défaut.
- Ne jamais inventer une norme, un seuil ou une procédure dans les textes de l'appli ou les prompts.

## Où trouver quoi
- `docs/VISION.md` : ce que Thomas attend de l'appli. Toute fonctionnalité doit y correspondre.
- `docs/ARCHITECTURE.md` : découpage de l'appli, données, services externes.
- `docs/ROADMAP.md` : les étapes, à faire dans l'ordre.
- `LISEZMOI.md` : mise en ligne et branchements (Google, Claude), pour Thomas.

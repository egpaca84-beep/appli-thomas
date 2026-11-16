# Feuille de route

Règle : on fait les étapes **dans l'ordre**. Une étape est cochée seulement quand
**tous** ses critères de fin sont vérifiés et que `npm run check` passe. Voir `CLAUDE.md`.

## Phase A — Base de travail saine

- [ ] **A1. Outils de vérification installés** (fait le 16/11 : `npm install` fait, `npm run check` s'exécute — à cocher par Thomas)
  - Node.js déjà installé sur le PC : vérifier que `node -v` répond dans le terminal de VS Code.
  - `npm install` fait dans le dossier du projet.
  - Fin : `npm run check` s'exécute. Les erreurs de lint existantes sont listées (pas forcément corrigées).

- [ ] **A2. Projet sous Git, hors de OneDrive**
  - ✅ Projet copié dans `C:\APLI\code-appli` (hors OneDrive), `git init` et premier commit faits le 16/11/2026.
  - ⬜ Ouvrir `C:\APLI\code-appli` dans VS Code (et plus l'ancien dossier OneDrive).
  - ⬜ Créer le dépôt sur GitHub et y envoyer le code.
  - Fin : `git status` propre, le code est visible sur GitHub, `node_modules` n'y est pas.

- [ ] **A3. Erreurs de lint corrigées** (fait le 16/11 : `wxText` et `needText` supprimées, 0 erreur ; à tester sur téléphone après publication : tous les écrans s'ouvrent)
  - Fin : `npm run lint` affiche 0 erreur. L'appli fonctionne comme avant (tour de tous les écrans).

- [ ] **A4. `LISEZMOI.md` complété**
  - Le contenu (version 2, sans API) est à jour. Ajouter une section « Développement » : dossier de travail, `npm install`, `npm run check`, publication.
  - Fin : chaque étape du LISEZMOI correspond à un écran, un réglage ou une commande qui existe vraiment.

- [ ] **A5. Appli en ligne et ouverte sur le téléphone**
  - GitHub Pages activé, adresse `https://<pseudo>.github.io/<dépôt>/` ajoutée comme origine autorisée dans Google Cloud.
  - Fin : sur le téléphone, l'appli s'ouvre, s'installe sur l'écran d'accueil, la météo s'affiche et la synchro Drive marche.

- [ ] **A6. Vérification automatique sur GitHub**
  - Ajouter `.github/workflows/check.yml` qui lance `npm run check` à chaque envoi.
  - Fin : la coche verte apparaît sur GitHub après un envoi ; une erreur volontaire la fait passer au rouge.

## Phase B — Rendre le code testable (sans changer le comportement)

- [ ] **B1. Passage en modules JavaScript**
  - `index.html` charge `js/main.js` en `type="module"`. Au départ, `main.js` = l'ancien `app.js` déplacé.
  - Mettre à jour `SHELL` dans `sw.js` et la config du lint.
  - Fin : appli identique sur PC et téléphone, `npm run check` passe.

- [ ] **B2. Sortir les dates** → `js/logique/dates.js` + `tests/dates.test.js`
  - Fin : tests sur `addDays` (changement de mois, d'année), `mondayOf` (dimanche, lundi), passage heure d'été/hiver.

- [ ] **B3. Sortir la météo et la décision nacelle** → `js/logique/meteo.js` + tests
  - `nacelleDecision(heures, limite)` reçoit la limite en paramètre (plus de lecture de `S`).
  - Fin : tests pour : limite vide, tout OK, tout NON, créneau du matin, créneau coupé en deux, rafale pile à la limite, virgule dans la limite (« 45,5 »).

- [ ] **B4. Sortir la validation de la boîte Claude** → `js/logique/boite.js` + tests
  - Séparer « vérifier le fichier » (pur, testé) de « l'appliquer à S ».
  - Fin : un test par `type` et par `kind`, plus les cas refusés (date invalide, champ manquant, type inconnu).

- [ ] **B5. Sortir stock et révision espacée** → `js/logique/stock.js`, `js/logique/revision.js` + tests
  - Fin : tests de `needList` (stock au minimum, outil à remplacer, manquant) et du calendrier J+1/3/7/14/30.

- [ ] **B6. Découper le reste** : `stockage.js`, `services/`, `ecrans/` (voir ARCHITECTURE)
  - Un écran à la fois, vérification entre chaque.
  - Fin : aucun fichier de plus de 400 lignes, `logique/` n'importe ni `services/` ni `ecrans/`.

## Phase C — Fiabilité terrain

- [ ] **C1. Hors réseau** : couper le réseau sur le téléphone.
  - Fin : l'appli s'ouvre, les écrans s'affichent, un message clair indique ce qui ne marche pas (météo, synchro).
- [ ] **C2. Synchro** : modifier sur le téléphone, synchroniser, vérifier sur le Drive ; déposer un fichier test dans la boîte.
  - Fin : la modif est dans `etat-appli.json`, le fichier test est appliqué une seule fois.
- [ ] **C3. Sauvegarde / restauration** : exporter, effacer, restaurer.
  - Fin : toutes les données reviennent.
- [ ] **C4. Portée Google Drive** : étudier le passage de `drive` (tout le Drive) à une portée plus étroite.
  - Fin : décision notée ici avec la raison.

## Phase D — Fonctionnalités de la vision (voir `docs/VISION.md`)
Ordre proposé ; chaque étape devra recevoir un critère de fin précis avant d'être commencée.

- [ ] **D1. Emplacement des outils** : chaque outil/matériel a un endroit (atelier, camion, chantier, prêté à…), modifiable.
- [ ] **D2. Débrief du soir complété** : questions « RDV pris », « à faire demain », puis vérification des emplacements (tout confirmer d'un geste, ou corriger).
- [ ] **D3. Bouton « Démarrer le brief »** : à faire + comment, listes à prendre (partir / atelier / fournisseur), mini-révision.
- [ ] **D4. Révision : nouvelles matières** : maths, physique, matériel ; élocution « explication concise ».
- [ ] **D5. Imprévu relié au prévu** : solutions, ordres modifiés, compte rendu modifié.
- [ ] **D6. Conversation** : selon la décision notée dans VISION.md.

---

## Journal
| Date | Étape | Ce qui a changé |
|---|---|---|
| 16/11/2026 | — | Création de CLAUDE.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, config lint et tests de base |
| 16/11/2026 | A2 | Projet déplacé dans C:\APLI\code-appli, dépôt Git créé |
| 16/11/2026 | A1, A3 | npm install fait ; 2 fonctions mortes supprimées (0 erreur de lint, 5 avertissements de complexité restants) |
| 16/11/2026 | — | File de prompts adaptée dans C:\APLI\file-de-prompts |
| 16/11/2026 | — | Ajout de l'étape A5 (appli en ligne sur le téléphone) ; test sur téléphone obligatoire dans chaque vérification |

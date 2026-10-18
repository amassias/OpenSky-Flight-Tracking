# Vérification de la réorganisation du dépôt

Date : 18 octobre 2026.

## Résultat

104 fichiers déplacés selon `docs/reorganization-files.json`. Les catalogues de `data/`, les fichiers publics et les silhouettes de `src/assets/` sont conservés sans modification.

- Avant : `npm run check` et 168 tests Python passent.
- Après : lint, 205 tests frontend, TypeScript et build passent.
- 168 tests Python passent, dont les routes FastAPI. Un avertissement de dépréciation Starlette/httpx préexistant reste présent.
- Chromium : 78 parcours passent, 2 ignorés.
- Générateur des codes compagnies : `--check` passe.
- Validation logos : 388 fiches, 364 activées, 69 types ; 411 assets opérateurs locaux valides.
- Budgets : entrée 70,6 kB gzip, vendor 158,9 kB gzip, identiques aux mesures avant déplacement.
- Démarrage réel avec `python3 -m backend.server` : santé, catalogue aéroports et service du frontend compilé vérifiés.
- Huit tâches ouvertes migrées vers les issues GitHub #3 à #10 et relues à distance.
- Ancienne application du dossier parent : README.md, package.json, server.js et public/ placés dans la Corbeille avec manifeste SHA-256 ; réglages et brouillons conservés. Le lanceur local Claude de SkyTrace utilise désormais `python3 -m backend.server`.

## Limites

Aucun déploiement effectué. Les parcours navigateur utilisent des réponses maîtrisées et ne vérifient pas la disponibilité de tous les fournisseurs externes. La réorganisation conserve les gros modules existants ; leur découpage reste suivi par B66–B68.

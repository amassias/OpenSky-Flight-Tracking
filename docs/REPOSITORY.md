# Carte du dépôt SkyTrace

## Où intervenir

| Emplacement | Responsabilité |
| --- | --- |
| `src/app/` | Démarrage React, assemblage des écrans, styles globaux et navigation générale |
| `src/features/map/` | Carte, marqueurs, mouvement, projection, filtres et labels |
| `src/features/flights/` | Détails d’un vol, airframe, cabine, trace, télémétrie et historique |
| `src/features/airports/` | Recherche d’aéroports, tableaux de vols et météo |
| `src/features/alerts/` | Watchlist et alertes |
| `src/shared/` | API navigateur, types, unités, identité, catalogues générés et composants communs |
| `src/assets/` | Ressources importées par le build, dont le sprite des silhouettes |
| `src/test/` | Initialisation commune des tests frontend |
| `backend/` | Services Python, clients fournisseurs, chargement des données et serveur local |
| `api/` | Adaptateurs de déploiement FastAPI et proxy OpenSky Node |
| `tests/` | Tests Python des services, données et routes FastAPI |
| `e2e/` | Parcours navigateur Playwright |
| `data/` | Catalogues embarqués, snapshots, provenance et licences |
| `public/` | Ressources servies à leur URL stable : logos, manifestes et fichiers publics |
| `scripts/` | Génération, imports et validation des catalogues et assets |
| `docs/` | Navigation documentaire, audits, décisions et archives |

Les tests frontend restent à côté du module testé. Un fichier va dans une fonctionnalité lorsqu’elle en porte la responsabilité ; `shared/` accueille les contrats et outils communs. Les échanges entre fonctionnalités restent des imports explicites.

## Points d’entrée

- `index.html` charge `src/app/main.tsx`, qui monte `src/app/App.tsx`.
- `npm run dev` démarre Vite ; `/api` passe par le proxy configuré dans `vite.config.ts`.
- `python3 -m backend.server` démarre le serveur local depuis la racine du dépôt.
- `api/index.py` expose les routes FastAPI pour Vercel. `vercel.json` conserve leurs URL publiques.
- `api/opensky-proxy.ts` reste le proxy Node OpenSky.
- `backend/server.py`, `backend/data_loader.py`, `backend/airport_live.py`, `backend/aircraft_history.py` et `backend/aircraft_enrichment.py` résolvent les ressources depuis la racine du dépôt, indépendamment de leur nouveau dossier.

Les configurations du build, les fichiers de dépendances et `.env.example` restent à la racine pour les outils. Les secrets locaux restent ignorés par Git.

## Données et fichiers générés

Les catalogues et assets versionnés sont nécessaires à l’exécution : un fichier généré n’est pas automatiquement supprimable. Conserver les sources, hashes et licences prévus par les ADR 0004 et 0006.

- `scripts/build_airline_codes.py` produit `src/shared/airlineCodes.ts`.
- `scripts/import_airline_logos.py` produit notamment `src/shared/airlineOperatorLogos.ts` et les logos publics.
- `scripts/build-icons.mjs` produit `src/shared/components/icons.tsx`.
- `scripts/build_aircraft_silhouettes.py` produit `src/assets/aircraft/models/`.
- `node_modules/`, `dist/`, les caches Python et les résultats Playwright sont des sorties locales ignorées.

## Vérification d’un changement de structure

```bash
npm run check
npm run check:size
python3 -m pytest -q
python3 scripts/build_airline_codes.py --check
python3 scripts/check_airline_logos.py
npx playwright test --project=chromium
```

Les tests Python incluent les routes de `api/index.py`. Les tests navigateur utilisent des données maîtrisées ; leur réussite ne prouve pas la disponibilité actuelle de tous les fournisseurs externes.

## État des lieux et suivi

GitHub Issues est la référence pour le travail ouvert. `docs/archive/BACKLOG.md` conserve l’historique et les liens des tâches migrées. `docs/BACKLOG.md` sert de redirection aux anciens liens.

La réorganisation du 18 octobre 2026 déplace les fichiers et adapte leurs références. Le découpage interne des gros modules reste un travail distinct : anciens identifiants B66, B67 et B68 dans GitHub Issues. Le [manifeste](reorganization-files.json) associe chaque ancien chemin à son nouveau chemin.

# Sources ADS-B gratuites et rendu temps réel — 18 octobre 2026

Objectif : afficher **tous** les avions (monde entier) avec un mouvement fluide, 100 % gratuit.
Méthode : lecture du code de SkyTrace, docs officielles, dépôts GitHub officiels, et **tests réseau directs** (curl, 18/10/2026, depuis un poste personnel à Paris). Chaque affirmation porte son URL ; les mesures sont marquées « mesuré ». Tout ce qui n'a pas pu être confirmé est marqué **[NON VÉRIFIÉ]**.

## 1. Pourquoi seule une fraction des avions s'affiche (code actuel)

Carte : **Leaflet 1.9 + react-leaflet, `preferCanvas`**, un `CircleMarker` React par avion (`package.json`, `src/features/map/components/FlightMap.tsx` l.1491 et l.398-432).

Deux chemins de données (`FlightMap.tsx` l.1152-1170) :

| Chemin | Quand | Limite structurelle |
| --- | --- | --- |
| **Public ADS-B** (adsb.fi puis adsb.lol, `backend/api_client.py` `_get_public_live_states`) | vue ≤ 2 cellules, ou OpenSky indisponible | cercles de **250 NM max** par requête ; front : `splitBoundsIntoTiles(bounds, maxTiles=24)` (`src/shared/utils.ts` l.159), cellules de 285 NM, triées du centre vers l'extérieur puis **tronquées à 24** ; back : `SKYTRACE_LIVE_MAX_TILES=36` |
| **OpenSky authentifié** (proxy serveur) | vues larges | budget `SKYTRACE_OPENSKY_DAILY_BUDGET=3000` crédits/jour, intervalle min 5 s (`.env.example` l.45-46) |

Causes de la couverture partielle :
1. **Pavage tronqué** : une vue Europe ou monde nécessite bien plus de 24-36 cercles de 250 NM ; les cellules périphériques sont simplement abandonnées (commentaire du code : « Extremely broad views are deliberately bounded »).
2. **Requêtes espacées de 1,3 s** (`SKYTRACE_LIVE_TILE_INTERVAL_SECONDS`) : 24 cellules ≈ 31 s pour un seul passage séquentiel.
3. **Cadence de rafraîchissement proportionnelle** : `refresh_after_seconds = clamp(20 × nb_cellules, 20, 180)` (`api_client.py` l.~720). Une grande vue est donc rafraîchie toutes les 3 min.
4. **Projection plafonnée à 90 s** (`aircraftMotion.ts`, `MAX_PROJECTION_SECONDS`) : au-delà, les avions se figent. Avec un rafraîchissement à 180 s, ils bondissent/gèlent.
5. **Budget OpenSky** : 3000 crédits/jour ; un appel sans bbox ou > 400 deg² coûte 4 crédits (https://openskynetwork.github.io/opensky-api/rest.html) soit ≈ 750 appels globaux/jour max, un toutes les ~115 s en continu.
6. **Quotas des agrégateurs publics partagés** : l'IP de la fonction Vercel est partagée par tous les visiteurs. Mesuré : l'en-tête de réponse adsb.lol est `x-ratelimit-limit: 4, 4;w=1, 60;w=60, 500;w=86400` (4/s, 60/min, **500/jour ?**). Le sens exact est **[NON VÉRIFIÉ]** (non documenté), mais s'il s'agit bien de 500 requêtes/jour par IP, un pavage de 24-36 requêtes épuise le quota en une vingtaine de rafraîchissements.
7. **Endpoint adsb.fi déprécié** : le code utilise `/api/v2/lat/.../dist/...` ; adsb.fi documente `/v3/lat/{lat}/lon/{lon}/dist/{dist}` et marque le v2 « deprecated, still works » (https://github.com/adsbfi/opendata). Les deux répondent encore (mesuré).
8. Aucun plafond dur du nombre d'avions affichés n'a été trouvé dans le code. Au-delà de 750 avions visibles, `denseTraffic` désactive libellés et traînées (`FlightMap.tsx` l.1419), mais tous restent dessinés. Le coût de rendu est donc surtout un risque, pas la cause actuelle.

## 2. Comparatif des sources

| | OpenSky Network | adsb.lol | adsb.fi | airplanes.live |
| --- | --- | --- | --- | --- |
| Requête globale (sans bbox) | **Oui** : `/states/all` sans paramètres | **Non** (point + rayon ≤ 250 NM) | **Non** pour le public (`/v2/snapshot` réservé aux feeders) | Non (point + rayon) **[NON VÉRIFIÉ]**, accès non-feeder voir note |
| Par zone | bbox `lamin/lomin/lamax/lomax` | `/v2/point/{lat}/{lon}/{r}`, r ≤ 250 NM | `/v3/lat/{lat}/lon/{lon}/dist/{d}`, d ≤ 250 NM | `/v2/point/...` ≤ 250 NM **[NON VÉRIFIÉ]** |
| Quota | anonyme 400 crédits/j ; compte 4 000/j ; feeder actif 8 000/j ; licence 14 400/h | « dynamique selon la charge » ; en-tête mesuré 4/s, 60/min, 500/j (sens non confirmé) | **1 req/s** public ; feeder : 1 req/30 s | **[NON VÉRIFIÉ]** : page officielle protégée par Cloudflare (403) |
| Coût en quota | 1 crédit (≤25 deg²) ... 4 crédits (> 400 deg² ou global) | 1 requête | 1 requête | — |
| Fraîcheur | résolution 10 s (anonyme), 5 s (authentifié) | quasi temps réel (`now` = horloge serveur) | idem | — |
| Authentification | OAuth2 *client credentials* uniquement (jeton 30 min) ; anonyme possible | aucune ; « à l'avenir une clé API (feeders) » | aucune | aucune annoncée **[NON VÉRIFIÉ]** |
| CORS navigateur | **Non** : mesuré, `access-control-allow-origin: https://opensky-network.org` renvoyé pour `Origin: https://example.com` | **Non observé** : aucun en-tête CORS, `OPTIONS` → 405 (mesuré) | **Non observé**, `OPTIONS` → 405 (mesuré) | non testable (403) |
| Licence / usage | usage live produit = licence écrite requise selon les Terms ; non-commercial toléré (voir note) | **ODbL 1.0** ; « contactez-moi pour un usage production » | **« personal, non-commercial use only »**, attribution, revente interdite | non-commercial (source secondaire) |
| Couverture mesurée | `/states/all` anonyme : **10 175 avions en 1 requête** (1,3 Mo) | 831 avions dans 250 NM autour de Paris | 860 avions, même zone | — |

Sources :
- OpenSky : https://openskynetwork.github.io/opensky-api/rest.html (crédits, résolution, OAuth2, global = 4 crédits, champs).
- OpenSky licence : https://opensky-network.org/about/terms-of-use (HTTP 403 à la lecture directe). **Résumé issu de la recherche web, [NON VÉRIFIÉ] mot pour mot** : recherche/éducation non-profit ; usage en produit/service live = licence écrite ; entités commerciales = licence. Le FAQ (https://opensky-network.org/about/faq) est plus souple (personnel et non-profit gratuits ; commercial sur accord). Les Terms prévalent probablement ; à relire avant production.
- adsb.lol : https://github.com/adsblol/api (BSD-3, « rate limits are dynamic », clé future) ; OpenAPI https://api.adsb.lol/api/openapi.json (« use the API for free », « for production purposes please contact me », ODbL, point ≤ 250 nm) ; https://www.adsb.lol/docs/open-data/api/ (ODbL 1.0).
- adsb.fi : https://github.com/adsbfi/opendata (endpoints, 1 req/s, non-commercial, attribution, snapshot feeders).
- airplanes.live : https://airplanes.live/api-guide/ renvoie 403/« Just a moment » (Cloudflare) à tout client automatisé, donc **non lu**. Un projet tiers (https://github.com/LinuxBozo/skylight) écrit « Feeders only since August 2026 - returns 403 to everyone else » : **[NON VÉRIFIÉ]**, source secondaire. Mon propre test `GET api.airplanes.live/v2/point/48.85/2.35/250` → **403** (cohérent, non concluant : peut être le filtre anti-bot). Je recommande de **ne pas dépendre** d'airplanes.live. Le « 1 req/s » trouvé dans les dépôts airplanes-live concerne **api.adsb.one** (https://github.com/airplanes-live/api-archive), pas airplanes.live.
- CORS et en-têtes : mesures curl du 18/10/2026 (résultats ci-dessus), à refaire depuis un vrai navigateur avant de s'y fier. Dans tous les cas un proxy serveur reste nécessaire pour OpenSky.

## 3. Techniques de rendu et de mise à jour

### Rendu de milliers d'avions
- **Leaflet** : `preferCanvas` dessine les `Path` en canvas au lieu de SVG (https://leafletjs.com/reference.html). SkyTrace l'utilise déjà. Mais un composant React + un `CircleMarker` par avion à 10 000 avions est un risque de performance **[NON MESURÉ ici]**.
- **MapLibre GL JS** : source GeoJSON + couche `symbol` (`icon-rotate` pilotable par donnée, `icon-allow-overlap: true` pour désactiver la collision) ou couche `circle` (https://maplibre.org/maplibre-style-spec/layers/). Le GeoJSON est tuilé dans un worker. `GeoJSONSource.updateData()` applique un diff incrémental (identifiant unique par feature requis, « meilleur effort ») et est conseillé pour des mises à jour fréquentes de grands jeux ; `setData()` remplace tout (https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/). Le clustering (`cluster`, `clusterRadius`, `clusterMaxZoom`) existe mais n'est pas adapté à des avions en mouvement (les clusters sont recalculés à chaque mise à jour).
- **deck.gl** : `IconLayer` avec atlas pré-assemblé (« the most efficient way »), `getAngle`, `getPosition`, **transitions** animables sur position/angle/couleur (https://deck.gl/docs/api-reference/layers/icon-layer). Guide de performance : couches de base à 60 FPS jusqu'à environ **1 million** d'éléments, données **binaires** (typed arrays) pour éviter le coût d'objets JS, `updateTriggers` pour ne régénérer qu'un attribut (https://deck.gl/docs/developer-guide/performance). Le chiffre 1 M porte sur les couches de base, pas explicitement sur `IconLayer` : **[NON VÉRIFIÉ]** pour 10-15 k icônes orientées, très probablement largement suffisant.
- Conclusion rendu : 10-15 k avions ne sont réalistes que via WebGL (MapLibre ou deck.gl). Le coût de la migration est le principal compromis (le code Leaflet, hover, silhouettes et tests e2e sont à refaire).

### Limiter à la zone visible
SkyTrace le fait déjà (bbox quantifiée, marge de 18 %, cache par viewport). Avec une source globale unique, le filtrage par bbox se fait **côté client** (tri par position), et le réseau ne dépend plus de la vue.

### Polling, WebSocket, SSE
Aucune des quatre sources ne propose de push public (**aucun endpoint WebSocket/SSE trouvé** dans leurs docs). Le temps réel = polling d'un instantané. SSE ne servirait qu'entre votre propre backend et le navigateur ; avec HTTP/1.1, 6 connexions par domaine (HTTP/2 : 100 par défaut) et reconnexion automatique (https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events). Les fonctions serverless à durée limitée s'y prêtent mal (limites Vercel **[NON VÉRIFIÉ]**, page https://vercel.com/docs/limits non exploitée jusqu'au quota Hobby). Recommandation : polling HTTP d'un instantané mis en cache CDN, pas de WebSocket.

### Interpolation / extrapolation (dead reckoning)
Déjà présent : `projectPosition` (cap + vitesse sol, grand cercle, plafonné à 90 s, jamais pour les positions d'âge inconnu — `src/features/map/aircraftMotion.ts`, ADR 0002). Pour un flux global rafraîchi toutes ~60-90 s, deux ajustements :
1. Animer à 10-30 images/s avec `requestAnimationFrame` (aujourd'hui tick 1 s) ; sur un grand parc, mettre à jour un buffer typé et laisser le GPU interpoler (transitions deck.gl, ou un calcul dans le vertex shader — idée de conception, non sourcée).
2. **Recaler en douceur** : à l'arrivée d'un nouveau fix, lisser l'écart entre la position projetée et la position observée sur ~1-2 s au lieu d'un saut.
Respecter le principe du projet : une position projetée reste une estimation, signalée comme telle.

## 4. Recommandation concrète, 100 % gratuite

**Architecture hybride « instantané global + zoom local »**

1. **Instantané global** : une fonction serveur (jamais le navigateur : pas de CORS, secrets côté serveur) appelle OpenSky `/states/all` **sans bbox, authentifié OAuth2** (4 crédits), et expose le résultat compact (champs utiles, tableaux, position arrondie) avec un en-tête de cache CDN partagé (`s-maxage`, `stale-while-revalidate`, **comportement exact sur Vercel [NON VÉRIFIÉ]**). Tous les visiteurs partagent un seul appel amont.
   - Budget : compte standard 4 000 crédits/j ÷ 4 = 1 000 appels/j ≈ **1 appel / 86 s** en continu ; compte feeder 8 000 crédits/j ≈ 1 appel / 43 s. Réduire la cadence la nuit ou quand personne n'est connecté pour rester sous le quota.
   - Mesuré : 1 appel anonyme = 10 175 avions, 1,3 Mo non compressé : prévoir gzip/Brotli côté CDN et un format compact (tableaux plutôt qu'objets ; gain **non mesuré**).
2. **Zoom local** (vue ≤ 1-2 cellules de 250 NM, c'est-à-dire zoom ≥ ~6) : requêtes point+rayon vers **adsb.fi v3** (1 req/s autorisé), repli adsb.lol, toutes les 5-10 s, via le proxy (CORS non observé). Fusion par `icao24` : garder la position au `time_position` le plus récent. Cache serveur 5 s par cellule quantifiée pour mutualiser entre visiteurs.
3. **Supprimer le pavage 24-36 cellules** pour les vues larges : il est remplacé par l'instantané global. Plus de rafraîchissement à 180 s.
4. **Mouvement** : rAF + projection jusqu'à ~120-150 s (au lieu de 90 s) pour couvrir l'intervalle de 86 s, avec recalage lissé ; libellé « position estimée » inchangé.
5. **Rendu** : migrer vers MapLibre GL (symbol layer + `updateData`) ou deck.gl `IconLayer`. À court terme, sans migration : garder Leaflet canvas, mais ne dessiner que les avions de la bbox visible et échantillonner par densité au-dessus de ~3 000.

**Compromis**
- *Licences* : OpenSky exige une licence écrite pour un produit/service live, adsb.fi interdit le commercial, adsb.lol demande de les contacter pour la production. Le site doit rester **gratuit, sans publicité, sans revente**, avec attribution (OpenSky, adsb.fi, adsb.lol/ODbL). Le déploiement sur Vercel Hobby est lui-même réservé à l'usage personnel/non commercial (règle plan Hobby **[NON VÉRIFIÉ]** ici).
- *Fraîcheur* : le monde entier est actualisé toutes les ~1-1,5 min (OpenSky), pas à la seconde ; seul le zoom local approche le temps réel (5-10 s).
- *Couverture* : OpenSky repose sur des récepteurs communautaires ; sa couverture réelle (océans, certaines régions) n'est pas documentée dans les sources lues : **[NON VÉRIFIÉ]**. Les agrégateurs adsb.lol/adsb.fi complètent localement.
- *Risque fournisseur* : quotas dynamiques (adsb.lol), clés annoncées, airplanes.live passé en accès restreint selon une source tierce. Garder deux sources locales et une dégradation explicite (« instantané de il y a N s »), comme le fait déjà `degraded`/`notice`.
- *Charge de données* : 1,3 Mo par instantané et par visiteur ; sur mobile, requêter avec filtrage serveur par bbox élargie du client au lieu du monde complet quand le zoom est élevé.

## 5. Ce qui n'a pas pu être vérifié
- Termes exacts d'OpenSky (page `terms-of-use` en 403) et d'airplanes.live (Cloudflare).
- Signification du quota `500;w=86400` de adsb.lol.
- Absence de CORS : mesuré en curl uniquement, pas depuis un navigateur.
- Limites Vercel Hobby (durée de fonction, fair use) et comportement exact du cache CDN.
- Performance de `IconLayer` / MapLibre `updateData` à 10 000+ icônes animées (aucun benchmark primaire trouvé ni exécuté).
- Couverture géographique réelle d'OpenSky ; la production de SkyTrace dispose-t-elle d'identifiants OpenSky valides (non vérifié, `.env` volontairement non lu).
- OpenSky depuis une IP de datacenter : le test global anonyme a été fait depuis une IP résidentielle ; un blocage ou une limitation côté Vercel n'est pas exclu.

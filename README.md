# AeroNav / VistaPath

**Zero-friction, predictive 3D hyper-lapse navigation for the open web.**

A deployed React / Three.js / Node prototype with two distinct workspaces: **Live navigation** connects real Google Maps and Google Cloud services; **Demo explorer** retains the original schematic San Francisco simulation. Real routes are displayed only on a Google Map with its attribution intact. Street View is the supported Google viewer, never downloaded into Three.js.

**Live prototype:** https://aeronav-933096818749.asia-south1.run.app

Deployed to `veonav` / `asia-south1`. The automated suite includes 19 tests covering demo regressions, real-route validation, signed sessions, worker idempotency, cloud-provider contracts, and persistent quotas.

## Live experience

1. Open **Live navigation** (the default). Search an origin and destination explicitly, selecting each result, or use the supplied San Francisco endpoints. GPS can supply your origin with permission.
2. Choose Driving or Walking and select **Plan with Google Maps**. This invokes Google Routes, not demo geometry. Routes are limited to 100 km and sessions last one hour.
3. Select **Load real Street View**. Available outdoor panoramas appear in Google's viewer with capture date and attribution. Missing coverage is reported, never substituted with synthetic imagery. Playback checks nearby imagery after 100 meters and at least 8 seconds, with at most 8 automatic lookups per route. Manual interactions inside Google's viewer can make additional requests.
4. Play or scrub the real route; click a maneuver to reach its preview zone. The app selects at most five separated maneuver zones heuristically. This is not a trained complexity predictor or automatic rerouting system.
5. Within 500 meters of a zone, **Auto prepare** requests a scene. Pub/Sub pushes to an authenticated worker; BigQuery indexes the coordinates and performs a 500-meter GIS lookup; Earth Engine samples NASADEM elevation; Gemini generates a structured advisory for the selected preview intent; private Cloud Storage delivers the result. Provider states show real successes or errors.
6. Inspect the **AI advisory**, terrain value, and spatial index count. Optional Three.js arrows are a separate illustrative scene, not calibrated overlays on Street View. Change AI preview intent before a scene is prepared; each scene is generated once.
7. Use GPS only near the planned route. No raw continuous GPS track is stored. Chosen routing endpoints and preview coordinates do reach Google services; see [Privacy](public/privacy.html) and [Terms](public/terms.html).

## Run locally

Requires Node.js 22 or newer.

```powershell
npm install
npm run build
npm start
```

Open http://localhost:8080. Without cloud configuration, choose **Explore** for the offline-data demo; the live workspace explicitly reports that it is unconfigured. For local live development use Application Default Credentials with access to the project and set the variables listed below in your process environment; never commit credential files or API keys. VS Code tasks **Build AeroNav** and **Run AeroNav** also support the isolated Node installation used to create this project. For frontend development, keep the API running and run `npm run dev` in another terminal; Vite proxies `/api` and `/ws` to port 8080.

```powershell
npm test
```

Tests cover playback, GPS projection, geofence boundaries, route validation, scene retrieval, HTTP endpoints, and WebSocket behavior.

## Pune homepage (`/`)

The primary `/` page retains the original application shell and defaults to a 514-meter historical Pune track. An orange notice states that video previews are demo-only and available only for this route. Initially it shows a placeholder, without loading Google Maps or video. “Show route on Google Maps” displays the recorded track and enables the separate “Simulate” button below it; Simulate opens the bottom-right forward preview. Play/Pause, Reset, and a progress slider drive simulated travel at approximately 14 km/h. The V1-style sidebar, route panel, and Google Map default to Pune. A bottom-right preview appears after Play and follows a target 40 meters ahead using one forward-only video, with no automatic rewind or looping. Video time is interpolated from recorded distances rather than free-running: pausing freezes it, reaching the end holds the last frame, and only explicit slider movement or Replay can revisit earlier imagery. Reset hides the preview. Frame blending softens the transitions; it does not reconstruct continuous driving footage. The Pune camera is calibrated +90° from its metadata-derived view, as confirmed by the user; each frame retains its route-relative heading and uses an 85° horizontal field of view. Crossfades are presentation transitions, not reconstructed continuous movement. The original application is available at `/old` (also `/old/`), with its live integrations unchanged. The homepage serves directly at `/` with no redirect. `/v2` and `/v2/` are retired and return 404.

V2 uses bundled media in `public/v2-pune/`. Google Maps uses the existing browser key from `/api/live/config` and can incur map-load charges; no Google routing or Street View requests are made by V2. Missing map configuration is reported without disabling the simulation. The overlaid line is a recorded GPS track, not a Google-calculated or verified driving route. Footage is from November 9, 2022, credited to Devdatta via Panoramax under CC BY-SA 4.0; source links and modification notices are included in the page and `credits.json`. Preserve attribution and share-alike obligations when redistributing derivatives.

To regenerate the bundled clips from a generated Pune segment, run `node scripts/prepare-pune-v2.mjs demo-output/<run>/segment-1`, then `node scripts/prepare-pune-forward.mjs demo-output/<run>/segment-1`, then `npm run build`. The forward preparation step is required for the current UI. Deploy the resulting app using the existing Cloud Run source deployment workflow. Raw `demo-output/` downloads are excluded from both Cloud uploads and Docker builds; the curated public clips are included. The app supports direct `/` and `/old` requests, returns 404 for retired `/v2` links, and supports byte-range video delivery.

Validation: `node --test tests/pune-v2.test.js tests/panoramax-demo.test.js` and `npm run build`.

## Panoramax preview generator (experimental)

Run `npm run demo:panoramax` with Node.js 22+, installed npm dependencies, and FFmpeg on PATH (including the v360 filter and libx264 encoder). The standalone script searches Mumbai, Hyderabad, then Pune only; it does not fall back outside India. `--india-only` remains accepted for compatibility; all searches are now India-only.

Verified Pune demo: `npm run demo:panoramax -- --region Pune --count 1 --frames 40` generates a roughly 13-second preview covering approximately 514 meters of the available recorded track. Use `--region Mumbai`, `--region Hyderabad`, or `--region Pune` to restrict searches; omit it to search all three in order. Other options: `npm run demo:panoramax -- --count 1 --frames 16 --output demo-output`. Each run creates a unique directory containing source images, attributed perspective frames, GIF/MP4 previews, per-frame source/license metadata, recorded GeoJSON tracks, a coverage manifest, and an HTML gallery. Generated files under `demo-output/` are gitignored. Network calls download public imagery; the existing Google navigation interface is unchanged.

The generator requires continuous 360° sequences with supported open licenses and known camera headings. It searches a bounded sample, rejects discontinuities, and exits unsuccessfully if it cannot produce the requested count (five by default), preserving completed previews and a report. Searches are not exhaustive coverage audits. Pune has a verified 48-image consecutive panorama sequence; five distinct usable segments have **not** been verified. Regular point-of-interest photos are not treated as driving footage.

These are historical recorded segments, not verified driving routes, flyover classifications, or live 100-meter-triggered previews. Preserve creator attribution, source links, capture dates, modification notices, and applicable license obligations when sharing images or derivatives (including CC BY-SA share-alike requirements). Review visual continuity and camera orientation before presenting a generated clip.

## Procedural demo in 90 seconds

Open **Explore** in the sidebar. This workspace remains simulated and does not call paid Maps services.

1. Select **Ferry Building**, **Pier 39**, or **Palace of Fine Arts**, then choose Driving or Walking.
2. Press **Start navigation**. Adjust Speed or scrub route progress. Speed zero freezes movement.
3. Click a maneuver under **Clarity, just ahead** to jump directly to its geofence. Scene metadata is prefetched 500 meters before entry. Geofence entry enables the hybrid view when automatic transitions are enabled.
4. Switch between 2D, hybrid, and 3D views. Drag the map, zoom/recenter it, and drag the street preview to look around.
5. Save a place and open **Saved places**. Open **Your journey** for route state and metadata status.
6. Open Settings to enable browser speech, orientation, or GPS. GPS matching only works within 150 meters of the curated San Francisco route. Elsewhere use simulation. Raw coordinates remain on the device; only route ID, progress, and speed reach the API.
7. Share the destination using the footer link. Supported immersive-VR devices display a WebXR button in the preview. HTTPS or localhost is required for privileged browser APIs. Safari and other browsers without WebXR use the standard 3D view.

## Deploy to Google Cloud Run

Approved target: project **veonav**, region **asia-south1**, service **aeronav**. Requires billing, authenticated gcloud, permission to enable services/build/deploy, create service accounts, grant the build role, and grant public invocation. The script uses a dedicated `aeronav-build` identity with `roles/run.builder` and a separate `aeronav-runtime` identity with scoped storage, dataset, topic, and secret access plus the project-level BigQuery job, Vertex AI user, Earth Engine viewer, and service-usage roles needed for live calls. Organization policies can prohibit public services.

```powershell
gcloud auth login
# For first-time setup, enable the live APIs and register the project with Earth Engine first.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\provision-live.ps1 -Project veonav -Region asia-south1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -Project veonav -Region asia-south1 -Live
```

The deployment script enables Cloud Run, Cloud Build, and Artifact Registry, uses the included multi-stage Dockerfile, caps the service at one instance, permits scale-to-zero, and verifies `/api/health` at the resulting public HTTPS URL. No cloud credentials belong in the project. Google Cloud stores login credentials in its own user configuration.

Cloud Shell alternative, after uploading this project without `node_modules` or credentials:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project=veonav
# These dedicated service accounts were created for the initial deployment.
# For a new project, create aeronav-build and aeronav-runtime first.
gcloud projects add-iam-policy-binding veonav --member=serviceAccount:aeronav-build@veonav.iam.gserviceaccount.com --role=roles/run.builder --condition=None
gcloud run deploy aeronav --source=. --project=veonav --region=asia-south1 --build-service-account=projects/veonav/serviceAccounts/aeronav-build@veonav.iam.gserviceaccount.com --service-account=aeronav-runtime@veonav.iam.gserviceaccount.com --allow-unauthenticated --min-instances=0 --max-instances=1 --memory=512Mi --cpu=1 --concurrency=40 --timeout=3600 --port=8080
```

**Live configuration:** `LIVE_INTEGRATIONS=true`, `GOOGLE_CLOUD_PROJECT`, `SCENE_BUCKET`, `SCENE_TOPIC`, `SPATIAL_DATASET`, `BQ_LOCATION`, `GEMINI_MODEL=gemini-2.5-flash-lite`, `EARTH_ENGINE_ENABLED=true`, `PUSH_AUDIENCE`, and `PUSH_SERVICE_ACCOUNT`. `MAPS_SERVER_KEY`, `MAPS_BROWSER_KEY`, and `ROUTE_SIGNING_SECRET` are injected from Secret Manager. Browser keys have exact-host referrer restrictions and a Maps JavaScript API restriction; the server key is restricted to Routes and Places. Browser API keys are necessarily visible to clients, not treated as secrets.

**Earth Engine:** Enable `earthengine.googleapis.com` and register `veonav` at https://code.earthengine.google.com/register?project=veonav. Registration and commercial/noncommercial eligibility must be completed by the project owner, not assumed. The deployed owner completed registration. Dataset: `NASA/NASADEM_HGT/001`, 30-meter elevation. This cannot identify road decks or safely disambiguate flyovers.

**Costs and limits:** A project-scoped **₹4,000/month gross-spend budget** has alerts at 50%, 90%, and 100% (the billing account uses INR). It is a conservative alert target for the requested $50, **not a hard spending cap**. Trial credits/free-tier eligibility are not guaranteed. Global persistent per-UTC-day counters enforce **100 Places searches, 30 Routes requests, and 60 scene preparations**, failing closed if quota storage is unavailable. Maps loads also have a 50/day project quota. BigQuery queries cap billed bytes at the 10 MiB minimum. Gemini output is capped at 256 tokens. Maps viewer interactions and operational overhead may incur additional charges.

Cloud Build, Artifact Registry, storage, Pub/Sub, Earth Engine, AI, bandwidth, and active Cloud Run requests can incur charges. Open WebSockets keep requests active. Close clients to allow scale-to-zero. Delete the service, unused build images, scene bucket, dataset, subscriptions/topics, secrets/API keys, and dedicated service accounts after the hackathon if no longer needed. Deleting a service does not delete those other resources.

## Architecture and API

```text
React + Google Maps / Street View + separate Three.js diagrams
    | Places search / Routes API; signed-session WebSockets
Node.js / Express — Cloud Run
    | Pub/Sub authenticated OIDC push
Scene worker — BigQuery GIS + Earth Engine → Vertex AI / Gemini
    | private, expiring Cloud Storage metadata
Client scene polling (capability-authenticated; no imagery caching)
```

### Live endpoints

- `GET /api/live/config` — public browser key, enabled features, and limits. Never returns server credentials.
- `POST /api/live/places` — `{ "query": "Ferry Building San Francisco" }`; explicit search, at most five results.
- `POST /api/live/route` — `{ "origin": [-122.4194,37.7765], "destination": [-122.3937,37.7955], "mode": "drive" }`; real geometry, steps, heuristic geofences, signed one-hour ticket.
- `/ws` — `{ "type": "live-telemetry", "ticket": "...", "progressMeters": 100, "speedKmh": 30 }`.
- `POST /api/live/scene` — `{ "ticket": "...", "sceneId": "...", "intent": "continue" }`; intent can be `continue`, `left`, or `right`.
- `GET /api/live/scene/:id` — `Authorization: Bearer <route-ticket>`; returns persisted queue, processing, ready, partial, or failure state.
- `POST /internal/scene-worker` — Pub/Sub only: validates Google OIDC audience and dedicated service-account identity before processing. Job claims use GCS generation preconditions. Provider errors remain explicit; delivery attempts are bounded.

`veonav-aeronav-scenes` is private with public-access prevention, uniform IAM, one-day lifecycle, and soft-delete disabled. Active metadata expires after 24 hours. BigQuery uses one-day partitions and expiration filters; provider time-travel retention may outlast active data. Google imagery and full route instructions are not persisted; only necessary temporary geographic coordinates and generated advisories are used. Gemini receives preview intent/elevation rather than Google imagery or raw instructions.

Run the explicitly billable live smoke test:

```powershell
node .\scripts\verify-live.mjs --allow-billable
```

It verifies one real search/route, signed WebSocket event, and all cloud providers through Pub/Sub and Storage. This is distinct from `npm test`, which uses deterministic provider doubles and makes no paid calls.

### Preserved demo endpoints

- `GET /api/health` — health status and enabled workspace flags.
- `GET /api/routes` — curated route catalog.
- `POST /api/route` — body `{ "destinationId": "ferry", "mode": "drive" }`.
- `GET /api/scenes/:id` — procedural frames and local-meter anchors; use each geofence's `sceneId`.
- `/ws` — send `{ "type": "telemetry", "routeId": "ferry-drive", "progressMeters": 350, "speedKmh": 36 }`. Receives a geofence state with prefetch and scene information. The browser reconnects after interruptions and uses local deterministic geofences while offline.

Geofence intervals are start-inclusive and end-exclusive. The client throttles rendering to at most 30 fps outside XR and skips unchanged frames while paused. Arrow anchors are read from the prepared scene pack. Map geometry and road scenes are independently illustrative; they are not registered to photographic imagery.

## Implemented vs. proposed

| Functional live integration | Remaining limitation |
|---|---|
| Google Places + Routes + Google Map | No automatic rerouting or validated lane-level localization |
| Supported Google Street View panoramas | Not downloadable cubemaps, seamless photo crossfades, or a live camera |
| Vertex AI Gemini structured preview advisories | No trained route complexity model; no photo-calibrated road-surface reasoning |
| BigQuery GIS coordinate index + proximity query | Temporary session-scoped preview points, not a global panorama catalog |
| Earth Engine NASADEM elevation sampling | Terrain resolution cannot distinguish stacked roads |
| Pub/Sub authenticated asynchronous preparation | Prototype worker, not a complete production operations platform |
| Private Cloud Storage generated scene delivery | Metadata only; no Google imagery cache or image inpainting |
| GPS simulation/matching and procedural Three.js arrows | Separate illustrative diagrams, not road-registered overlays |

The procedural demo scene pack contains camera positions, not image assets. In Live navigation, Google's own viewer displays real historical panoramas; the separate Three.js renderer remains a synthetic repeating streetscape. This is not a seamless real-image hyper-lapse or calibrated AR system. No camera feed is opened. The often-proposed “80% battery savings” has **not** been measured and is not presented as a result. This app is a simulation/research prototype, **not for actual driving or safety-critical navigation**. A production product would require map-provider licensing, positioning validation, calibrated image/anchor registration, privacy review, and real-device performance testing.

Project layout: `src/` client; `server/` API and deterministic spatial model; `tests/` Node tests; `scripts/` build/deployment helpers. Google Fonts is optional; system fonts are used if unavailable. Live mode uses restricted Google Maps keys injected through Secret Manager. No private server keys or service-account key files are committed to the repository. Google provider failures are shown explicitly instead of silently falling back to demo data.

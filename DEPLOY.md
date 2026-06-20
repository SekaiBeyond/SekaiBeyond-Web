# Deployment

The site deploys automatically to Firebase Hosting when you push to `main` via GitHub Actions.

## First-Time Setup

### 1. Firebase Project

> **Note:** Steps 5–8 below (rules, indexes, storage, functions) are re-applied automatically by the GitHub Actions workflow on every push to `main`. You only need to run them manually for the initial project setup or when CI is unavailable.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values — you'll paste these into [GitHub secrets](#2-github-repository-secrets) for CI and [`.env`](#3-local-development) for local dev
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules** — copy the contents of [`firestore.rules`](firestore.rules) into the Firestore Rules editor
6. Deploy the required **Composite Indexes**:
   - Either click the index creation link shown in the browser error when you first use the app, **or**
   - Deploy the indexes defined in [`firestore.indexes.json`](firestore.indexes.json) with `firebase deploy --only firestore:indexes`

   Without these composite indexes, certain queries will fail with a `missing index` error.

7. Deploy **Storage Rules** — copy the contents of [`storage.rules`](storage.rules) into the Storage Rules editor, or deploy via `firebase deploy --only storage`

   Storage rules control access to user avatars and admin-uploaded images (event/badge images). Without deploying these, storage defaults to locked-down and all image uploads will fail.

8. Deploy **Cloud Functions** — the app uses callable Cloud Functions plus Firestore-trigger functions for all data mutations (user profile creation, admin operations, badge/event management, image uploads, ticketing, TTL-driven deletions, etc.). Without these, the entire app is non-functional:

   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```

9. Configure **Firestore TTL Policies** — the app relies on TTL-based auto-expiry for rate limiting, audit-log retention, deferred deletion of users/events/badges, and cleanup of expired claim/activation codes. Eight TTL policies are required:

   | Collection              | Field       | Purpose                                                     |
   |-------------------------|-------------|-------------------------------------------------------------|
   | `rateLimits`            | `expiresAt` | Clean up rate-limit windows                                 |
   | `records`               | `expiresAt` | Audit-log retention (30 days)                               |
   | `claimCodes`            | `expiresAt` | Auto-expire event claim codes past their active window      |
   | `badgeActivationCodes`  | `expiresAt` | Auto-expire badge activation codes past their active window |
   | `users`                 | `deleteAt`  | 48h cooldown for account deletion                           |
   | `pastEvents`            | `deleteAt`  | 48h cooldown for past-event deletion                        |
   | `upcomingEvents`        | `deleteAt`  | 48h cooldown for upcoming-event deletion                    |
   | `badges`                | `deleteAt`  | 48h cooldown for badge deletion                             |

   The fastest way to create all eight is via the included script (requires `gcloud` CLI authenticated to the project):

   ```bash
   npm run deploy:ttl
   ```

   Or create each manually in Firebase Console under **Firestore** > **TTL** > **Create policy**.

   > **Note:** Firestore TTL requires the **Blaze plan** (pay-as-you-go). It is not available on the free Spark plan.

   Without these policies, rate-limit entries and audit logs accumulate indefinitely, and deletion cooldowns will never fire the cleanup triggers.

10. Configure **outbound email (Resend)** — paid event ticketing and admin custom emails are delivered through **[Resend](https://resend.com)**. The `sendTicketEmails`, `sendCustomEmail`, and `scheduledMailDrain` Cloud Functions call the Resend API directly (the batch endpoint). Resend's free tier (3,000/mo, 100/day) covers the project's expected ~1,000 emails/month with headroom for event-day bursts, and its DNS setup plays cleanly with Cloudflare.

    **Step A — Set up Resend and verify `sekaibeyond.com`**

    1. Sign up at [resend.com](https://resend.com) and confirm your account email.
    2. Go to **Domains** > **Add Domain**, enter `sekaibeyond.com`, and follow Resend's on-screen DNS setup instructions — it auto-detects Cloudflare and can provision the MX/SPF/DKIM/DMARC records for you via OAuth. Click **Verify DNS Records** once the dashboard shows everything green.
    3. Go to **API Keys** > **Create API Key**, name it `sekaibeyond-functions`, scope it to **Sending access** only, and copy the key (starts with `re_`). You won't be able to view it again.

    **Step B — Store the API key as a Functions secret**

    The functions read the key through `defineSecret("RESEND_API_KEY")`, which resolves via **Google Secret Manager** — *not* a `.env` file. Set it once:

    ```bash
    firebase functions:secrets:set RESEND_API_KEY
    ```

    Paste the `re_…` key from Step A.3 when prompted. The secret must exist before the email functions are deployed:

    - **Manual deploy:** if the secret is missing, `firebase deploy --only functions` prompts to create it interactively.
    - **CI deploy:** the GitHub Actions workflow is non-interactive — run the command above *before* the first CI deploy of this code, or the deploy fails. CI reuses the stored secret automatically afterward; you only re-run the command to rotate the key. The deploy service account also needs the **Secret Manager Admin** role (`roles/secretmanager.admin`) — this is *not* included in **Firebase Admin** or **Cloud Functions Admin** and must be granted explicitly (see [Section 2](#2-github-repository-secrets)). Without it, the deploy fails with `403 Permission 'secretmanager.secrets.get' denied` when it reaches a secret-bound function. The deploy needs *Admin* (not just *Viewer*) because the CLI also sets an IAM binding granting the functions runtime service account access to the secret.

    The **From address** defaults to `mika@sekaibeyond.com` (in `functions/src/utils/config.ts`). To use a different sender, set `RESEND_FROM_ADDRESS` via project-scoped dotenv (see Step 12) — it must be an address on the verified domain.

    **Step C — Send a test**

    After deploying Functions, trigger a real ticket email or a custom email from the **Admin Panel**. Cross-check Resend's **Logs** tab in the dashboard, which surfaces bounces, suppressions, and DKIM failures. As a second signal, the functions cache Resend's daily-quota counter in the `system/resendQuota` Firestore doc — a populated `dailyConsumed` value there after a send confirms the response-header path works.

    > If Cloudflare Email Routing is also handling inbound mail for `sekaibeyond.com`, leave its existing MX records on the apex (`sekaibeyond.com`) untouched — Resend's MX is on the `send.` subdomain and won't conflict.

    > **Overflow queue:** sends past Resend's 100/day cap are written to a `scheduledMail` collection and drained by the `scheduledMailDrain` scheduled function every 30 minutes as quota frees up. No setup needed — it deploys with the other functions.

    > **Migrated from the Trigger Email extension:** earlier versions delivered mail via the Firebase "Trigger Email" extension, which read a `mail/{autoId}` collection. The functions no longer write to `/mail`. If that extension is still installed it is now idle and can be uninstalled.

11. Configure **Firebase App Check** — the app initializes App Check with reCAPTCHA v3 to protect Firestore, Storage, and callable Functions from unauthorized clients. If App Check is enforced in Firebase Console without the steps below, all reads/writes will fail with `FirebaseError: Missing or insufficient permissions`.

    **Step A — Create a reCAPTCHA v3 site key**

    1. Go to [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) and register a new site:
       - Type: **reCAPTCHA v3**
       - Domains: add **every** domain the site is served from — e.g. `sekaibeyond.com`, `www.sekaibeyond.com`, `<project-id>.web.app`, `<project-id>.firebaseapp.com`, and any custom preview hosts. Missing domains here is the #1 cause of post-enforcement permission errors.
    2. Copy the **site key** and the **secret key**.

    **Step B — Register the web app in Firebase App Check**

    1. Firebase Console > **App Check** > **Apps** > select your web app > **reCAPTCHA v3**.
    2. Paste the **secret key** from Step A.2 and save.
    3. Leave Firestore / Storage / Functions enforcement **off** until Step D verifies tokens are flowing.

    **Step C — Wire the site key into the build**

    Add `VITE_RECAPTCHA_SITE_KEY=<site-key>` to:
    - GitHub repo secrets (see [GitHub Repository Secrets](#2-github-repository-secrets) below) — required for production builds.
    - Local `.env` — required for `npm run dev` to obtain real tokens.

    Vite inlines `VITE_*` at build time, so the bundle must be rebuilt after the secret is added or App Check will silently no-op in production.

    **Step D — Verify before enforcing**

    Deploy, then open the production site with DevTools > Network:
    - `firebaseappcheck.googleapis.com/v1/.../exchangeRecaptchaV3Token` should return **200**. A 4xx means the site key, secret, or registered domain doesn't match.
    - A Firestore request should include the `X-Firebase-AppCheck` header.

    Only once both checks pass, go to App Check > **APIs** and click **Enforce** for Firestore, Storage, and Cloud Functions.

    **Optional — Debug tokens for local development**

    For local dev (or staging hosts not registered with reCAPTCHA), set `VITE_APP_CHECK_DEBUG_TOKEN=true` in `.env`. The first page load logs a debug token to the browser console; copy it into Firebase Console > App Check > Apps > **Manage debug tokens** to allow that specific token through enforced services. Set `VITE_APP_CHECK_DEBUG_TOKEN=<token>` in `.env` to reuse the same token across sessions.

12. Override `PUBLIC_ORIGIN` for forks — `sendTicketEmails` embeds ticket-claim URLs (`{PUBLIC_ORIGIN}/claim?ticket=X&event=Y`) into the QR images it generates. Without this, forks will send QR codes pointing at the original site (`https://sekaibeyond.com`, the in-source default — see `functions/src/index.ts`) instead of their own deployment.

    The function reads `process.env.PUBLIC_ORIGIN` at runtime, so any of these will work:

    - **Project-scoped dotenv (recommended):** create `functions/.env.<project-id>` (e.g. `functions/.env.sekaibeyond-fc616`, suffix from `.firebaserc`) containing `PUBLIC_ORIGIN=https://your-site.example.com`. Firebase loads it only when deploying to that project, so values don't leak into other environments. (Project-scoped also sidesteps Firebase's rejection of `FIREBASE_`/`X_GOOGLE_`/`EXT_`-prefixed keys in plain `.env`.)
    - **Generic dotenv:** `functions/.env` applies to every project this repo deploys to.
    - **gcloud:** `gcloud functions deploy <name> --update-env-vars PUBLIC_ORIGIN=...` (per function — tedious for this codebase since there are many).

    Then redeploy Functions so the new value is picked up:

    ```bash
    firebase deploy --only functions
    ```

    The same mechanism applies to the optional settings `RESEND_FROM_ADDRESS` (default `mika@sekaibeyond.com`), `RESEND_DAILY_CAP` (default 100), `SEND_CHUNK_SIZE` (default 100), and `IMPORT_MAX_ROWS` (default 1000). See `functions/.env.example` for the full list. Note that `RESEND_API_KEY` is *not* one of these — it is a Secret Manager secret, set via `firebase functions:secrets:set` (see Step 10).

13. Configure **Google Maps Platform** — the **Parking Guide** page and the admin **Map Picker** render an interactive map via `@vis.gl/react-google-maps`, keyed by `VITE_GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAPS_MAP_ID`. Without these, the map silently fails to load (the script request goes out with an empty `key=`, and the Maps JS API logs `The Google Maps JavaScript API could not load`).

    **Step A — Enable the API and create a browser key**

    1. In [Google Cloud Console](https://console.cloud.google.com) (same project as Firebase), go to **APIs & Services** > **Library** and enable **Maps JavaScript API**.
    2. Go to **APIs & Services** > **Credentials** > **Create credentials** > **API key**.
    3. **Restrict the key** (critical — an unrestricted key is a billing risk and will be flagged by Google):
       - **Application restrictions** > **Websites (HTTP referrers)** — add **every** host the site is served from, with a wildcard path: `https://sekaibeyond.com/*`, `https://www.sekaibeyond.com/*`, `https://<project-id>.web.app/*`, `https://<project-id>.firebaseapp.com/*`, and `http://localhost:*/*` for local dev. A referrer list that omits production is the #1 cause of a blank map plus a `RefererNotAllowedMapError` in the console.
       - **API restrictions** > **Restrict key** > select **Maps JavaScript API**.

    **Step B — Create a Map ID (required for Advanced Markers)**

    The app uses `AdvancedMarker`, which only renders on a map tied to a **Map ID**. In Cloud Console go to **Google Maps Platform** > **Map management** > **Create Map ID**, choose **JavaScript** > **Vector**, and copy the ID. (Falling back to the built-in `DEMO_MAP_ID` works for local tinkering but watermarks the map and is not for production.)

    **Step C — Wire both values into the build**

    Add to **both** targets — `VITE_*` vars are inlined by Vite at build time, so the bundle must be rebuilt after they change:
    - GitHub repo secrets (see [GitHub Repository Secrets](#2-github-repository-secrets)) — required for production builds. The deploy workflow passes them to the `Build` step.
    - Local `.env` — required for the map to appear under `npm run dev`.

    ```
    VITE_GOOGLE_MAPS_API_KEY=<browser-key-from-Step-A>
    VITE_GOOGLE_MAPS_MAP_ID=<map-id-from-Step-B>
    ```

    **Step D — Content-Security-Policy (already wired)**

    The CSP header in `firebase.json` already allowlists the Maps domains (`https://maps.googleapis.com` in `script-src`; `https://*.gstatic.com` / `https://*.ggpht.com` in `img-src`; `worker-src 'self' blob:` for vector-map workers), so forks need no CSP changes for the map. If you add other third-party scripts, extend that header accordingly — and note that the deploy-time `npm run update-csp-hashes` only rewrites the inline-script `sha256-` hashes inside `script-src`, preserving every other source token.

#### Firestore Indexes Explained

Firestore requires composite indexes for queries that filter on multiple fields. Each index is a sorted table covering the fields in order, allowing O(1) lookups instead of O(n) collection scans.

The app currently requires 7 composite indexes (defined in [`firestore.indexes.json`](firestore.indexes.json)):

| Collection | Fields | Purpose |
|---|---|---|
| `attendees` | `[emailSent, createdAt]` | Admin tickets panel: query unsent attendees for bulk ticket-email send |
| `badgeActivationCodes` | `[badgeId, createdAt desc]` | Admin panel: load codes for a badge |
| `records` | `[type, timestamp desc]` | Activity log by type |
| `records` | `[performedBy, timestamp desc]` | Activity log by user |
| `records` | `[type, performedBy, timestamp desc]` | Activity log filtered by type and user |
| `upcomingEvents` | `[published, startAt]` | Public listing of published upcoming events, sorted by start time |
| `users` | `[group, joinedAt desc]` | Admin panel: list users by group, newest first |

### 2. GitHub Repository Secrets

Go to your repo > **Settings** > **Secrets and variables** > **Actions**, and add these secrets:

| Secret                              | Value                               |
|-------------------------------------|-------------------------------------|
| `VITE_FIREBASE_API_KEY`             | Your Firebase API key               |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `your-project.firebaseapp.com`      |
| `VITE_FIREBASE_PROJECT_ID`          | Your project ID                     |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `your-project.firebasestorage.app`  |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID                      |
| `VITE_FIREBASE_APP_ID`              | Your app ID                         |
| `VITE_RECAPTCHA_SITE_KEY`           | reCAPTCHA v3 site key (App Check)   |
| `VITE_GOOGLE_MAPS_API_KEY`          | Maps JS API browser key (see Step 13) |
| `VITE_GOOGLE_MAPS_MAP_ID`           | Vector Map ID for Advanced Markers  |
| `FIREBASE_SERVICE_ACCOUNT`          | Service account JSON (see below)    |

The `VITE_*` secrets are injected as build-time environment variables. `FIREBASE_SERVICE_ACCOUNT` authenticates the deploy step.

> **Note:** The `.firebasestorage.app` suffix is the default for Firebase projects created after October 2024. Older projects use `.appspot.com` — use whichever format Firebase Console shows for your bucket.

**Generating `FIREBASE_SERVICE_ACCOUNT`:**

1. Open [Google Cloud Console](https://console.cloud.google.com) and select your Firebase project
2. Go to **IAM & Admin** > **Service Accounts** > **Create Service Account**
3. Name it something like `github-actions-deploy`
4. Grant these roles:
   - **Firebase Admin** (broad, simplest), or more narrowly: **Firebase Hosting Admin**, **Cloud Functions Admin**, **Firebase Rules Admin**, **Storage Admin**
   - **Secret Manager Admin** (`roles/secretmanager.admin`) — required to deploy the secret-bound email functions; not covered by Firebase Admin (see [Step 10](#1-firebase-project))
   - **Cloud Scheduler Admin** (`roles/cloudscheduler.admin`) — required to create/update the Cloud Scheduler job behind the `scheduledMailDrain` scheduled function; not covered by Firebase Admin or Cloud Functions Admin. Without it, deploys that change the function's schedule fail with `403 ... lacks IAM permission "cloudscheduler.jobs.update"`.
   - **Service Account User**
5. After creating, open the service account, go to the **Keys** tab, click **Add Key** > **Create new key** > **JSON**, and download the file
6. Paste the entire file contents into the `FIREBASE_SERVICE_ACCOUNT` secret value in GitHub

### 3. Local Development

Copy `.env.example` to `.env` and fill in the same Firebase config values:

```bash
cp .env.example .env
```

Then run `npm run dev` to start the dev server.

### 4. User Groups

The site uses a role-based group system instead of a simple admin flag. Users are assigned one of the following groups (lowest to highest):

| Group        | Description                                          |
|--------------|------------------------------------------------------|
| `visitor`    | Default for newly signed-in users                    |
| `member`     | Registered club members                              |
| `staff`      | Staff members                                        |
| `core-staff` | Core staff — can access the admin panel              |
| `president`  | Club president — can access the admin panel          |

**Bootstrapping the first president:**

1. Sign in to the site so your user document is created in Firestore
2. In Firebase Console > Firestore > `users` collection, find your document
3. Add or edit the `group` field and set it to `president`

Once the first president is set up, they can assign groups to other users through the **Admin Panel** on the site. Only `core-staff` and `president` can access the admin panel and assign groups below their own level.

## Deploy Workflow

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`):

1. Installs dependencies (root and `functions/`)
2. Builds the site with Firebase env vars from secrets
3. Authenticates to Google Cloud via the service account
4. Runs `firebase deploy` — ships hosting, Cloud Functions, Firestore rules/indexes, and Storage rules in a single command

You can also trigger a deployment manually from the **Actions** tab > **Deploy to Firebase** > **Run workflow**.

### Lockfiles

The root `package-lock.json` is intentionally not committed (see `.gitignore`). The root `package.json` dependency set is small and pinned to stable, actively-maintained packages, so `npm install` in CI or a fresh clone resolves to the same effective tree without the extra churn of tracking the lockfile through every transitive bump. If a future dependency change requires a pinned lockfile (e.g. a semver-range-sensitive package, a native dep that needs exact-version resolution, or a supply-chain hardening requirement), restore it by removing the `package-lock.json` line from `.gitignore` and committing the generated file.

`functions/package-lock.json` **is** committed — Cloud Functions deploys run `npm ci` against it and the functions runtime is much more sensitive to transitive-dep drift (native modules, Node-version-specific builds).

### Manual deploy (escape hatch)

If CI is unavailable, you can still deploy from your local machine:

```bash
npm run deploy            # full deploy (build + hosting + rules + functions + indexes)
npm run deploy:rules      # just functions, rules, and indexes — skips frontend rebuild
npm run deploy:ttl        # (re)apply Firestore TTL policies via gcloud
```

Both require `firebase login` locally.
# Deployment

The site deploys automatically to Firebase Hosting when you push to `main` via GitHub Actions.

## First-Time Setup

### 1. Firebase Project

> **Note:** Steps 5–9 below (rules, indexes, storage, functions, TTL policies) are re-applied automatically by the GitHub Actions workflow on every push to `main`. You only need to run them manually for the initial project setup or when CI is unavailable.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values — you'll paste these into [GitHub secrets](#2-github-repository-secrets) for CI, and into [`.env`](#3-local-development) to run the dev server against production
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules** — copy the contents of [`firestore.rules`](../firestore.rules) into the Firestore Rules editor
6. Deploy the required **Composite Indexes**:
   - Either click the index creation link shown in the browser error when you first use the app, **or**
   - Deploy the indexes defined in [`firestore.indexes.json`](../firestore.indexes.json) with `firebase deploy --only firestore:indexes`

   Without these composite indexes, certain queries will fail with a `missing index` error. See [Composite indexes](firestore.md#composite-indexes) for what each one is for.

7. Deploy **Storage Rules** — copy the contents of [`storage.rules`](../storage.rules) into the Storage Rules editor, or deploy via `firebase deploy --only storage`

   The rules allow public reads under the asset folders (`avatars/`, `banners/`, `events/`, `badges/`, and so on) and deny every client write. The app doesn't depend on them: the browser never uses the Storage SDK, uploads go through Cloud Functions (the Admin SDK isn't bound by rules), and images load through tokened download URLs, which bypass rules. What the rules do is stop anyone from writing to the bucket directly.

8. Deploy **Cloud Functions** — the app uses callable Cloud Functions plus Firestore-trigger functions for all data mutations (user profile creation, admin operations, badge/event management, image uploads, ticketing, TTL-driven deletions, etc.). Without these, the entire app is non-functional:

   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```

9. Configure **Firestore TTL Policies** — the app relies on TTL-based auto-expiry for rate limiting, audit-log retention, deferred deletion of users/events/badges, cleanup of expired claim/activation codes, scan-event retention, and per-client scan quotas. All ten policies are defined in [`firestore.indexes.json`](../firestore.indexes.json), so they deploy with the indexes:

   ```bash
   firebase deploy --only firestore:indexes
   ```

   > **Note:** Firestore TTL requires the **Blaze plan** (pay-as-you-go). It is not available on the free Spark plan.

   See [TTL policies](firestore.md#ttl-policies) for each policy and what to keep when adding one.

10. Configure **outbound email (Resend)** — paid event ticket emails are delivered through [Resend](https://resend.com). Follow [Ticket Email](email.md) to verify the domain, create the API key and store it as the `RESEND_API_KEY` Functions secret. CI deploys are non-interactive, so the secret must exist before the first CI deploy of the email functions, or the deploy fails.

11. Configure **Firebase App Check** — the app initializes App Check with reCAPTCHA v3 to protect Firestore, Storage, and callable Functions from unauthorized clients. Follow [App Check](app-check.md) before enforcing it in Firebase Console: enforced without that setup, all reads/writes fail with `FirebaseError: Missing or insufficient permissions`.

12. Override `PUBLIC_ORIGIN` for forks — ticket emails from `sendTicketEmails` embed QR images served from `{PUBLIC_ORIGIN}/api/ticket-qr`, and `serveTicketQr` encodes a ticket-claim URL (`{PUBLIC_ORIGIN}/claim?ticket=X&event=Y`) into each one. Its host is also the domain every email is sent from (see [Ticket Email](email.md)), less any leading `www.`. Without this, forks will send QR codes pointing at the original site (`https://sekaibeyond.com`, the in-source default — see `functions/src/utils/config.ts`) instead of their own deployment, from a sender Resend rejects.

    The functions read `process.env.PUBLIC_ORIGIN` at runtime. Set it in a dotenv file under `functions/`:

    - **Project-scoped dotenv (recommended):** create `functions/.env.<project-id>` (e.g. `functions/.env.sekaibeyond-fc616`, suffix from `.firebaserc`) containing `PUBLIC_ORIGIN=https://your-site.example.com`. Firebase loads it only when deploying to that project, so values don't leak into other environments.
    - **Generic dotenv:** `functions/.env` applies to every project this repo deploys to.

    Then redeploy Functions so the new value is picked up:

    ```bash
    firebase deploy --only functions
    ```

    The same mechanism applies to the optional settings `RESEND_DAILY_CAP` (default 100), `SEND_CHUNK_SIZE` (default 100), `RESEND_QUEUE_CAP` (default 500), `IMPORT_MAX_ROWS` (default 1000), `MAX_UPLOAD_SIZE_MB` (default 10), and `SCAN_CLIENT_SALT`. The salt has a fallback in source, so set your own to keep the hashed scan-client keys from being reversed by someone holding both the source and a database export. `functions/.env.example` describes each one. Note that `RESEND_API_KEY` is *not* one of these — it is a Secret Manager secret, set via `firebase functions:secrets:set` (see [Ticket Email](email.md#2-store-the-api-key-as-a-functions-secret)).

13. **Maps need no setup.** The **Parking Guide** and the admin panel's maps (the Locations map, the map picker for venues and QR spots, and the QR spots map) draw [OpenFreeMap](https://openfreemap.org) tiles of OpenStreetMap data with MapLibre GL: no key, no billing, no request limit. The map picker's place search uses OpenStreetMap's [Nominatim](https://nominatim.org/release-docs/latest/api/Search/), whose usage policy allows a search when someone asks for one (at most one a second, and no search-as-you-type), which is how the picker uses it.

    > **Parking data:** lot details, UW's event-parking days and walking times come from UW Transportation Services and OpenStreetMap. The `uwParkingNightlySync` scheduled function copies them into `uwParking/current` every day at 5:30 PM Pacific; it deploys with the other functions and needs no keys. To fill it right after the first deploy, use **Force run** on its job in [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler).

    The CSP header in `firebase.json` already allows what the maps need: `https://tiles.openfreemap.org` in `img-src` and `connect-src` (tiles, fonts and icons), `https://nominatim.openstreetmap.org` in `connect-src` (place search), and `worker-src 'self'` for MapLibre's worker, which the build bundles as a same-origin file. If you add other third-party scripts, extend that header accordingly — the deploy-time `npm run update-csp-hashes` only rewrites the inline-script `sha256-` hashes inside `script-src`, preserving every other source token.

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
| `FIREBASE_SERVICE_ACCOUNT`          | Service account JSON (see below)    |

The `VITE_*` secrets are injected as build-time environment variables. `FIREBASE_SERVICE_ACCOUNT` authenticates the deploy step.

> **Note:** The `.firebasestorage.app` suffix is the default for Firebase projects created after October 2024. Older projects use `.appspot.com` — use whichever format Firebase Console shows for your bucket.

**Generating `FIREBASE_SERVICE_ACCOUNT`:**

1. Open [Google Cloud Console](https://console.cloud.google.com) and select your Firebase project
2. Go to **IAM & Admin** > **Service Accounts** > **Create Service Account**
3. Name it something like `github-actions-deploy`
4. Grant these roles:
   - **Firebase Admin** (broad, simplest), or more narrowly: **Firebase Hosting Admin**, **Cloud Functions Admin**, **Firebase Rules Admin**, **Storage Admin**
   - **Secret Manager Admin** (`roles/secretmanager.admin`) — required to deploy the secret-bound email functions; not covered by Firebase Admin (see [Ticket Email](email.md#2-store-the-api-key-as-a-functions-secret))
   - **Cloud Scheduler Admin** (`roles/cloudscheduler.admin`) — required to create/update the Cloud Scheduler jobs behind the `scheduledMailDrain` and `uwParkingNightlySync` scheduled functions; not covered by Firebase Admin or Cloud Functions Admin. Without it, deploys that change the function's schedule fail with `403 ... lacks IAM permission "cloudscheduler.jobs.update"`.
   - **Service Account User**
5. After creating, open the service account, go to the **Keys** tab, click **Add Key** > **Create new key** > **JSON**, and download the file
6. Paste the entire file contents into the `FIREBASE_SERVICE_ACCOUNT` secret value in GitHub

### 3. Local Development

`npm run dev` runs the site against the [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite), never production, and needs no `.env`. See [Testing with the Emulators](emulators.md) for running them, signing in as an admin, and what differs from production.

**Against production.** `npm run dev:prod` runs the site against the real project, using the config in `.env`. Every change it makes is live, and sending tickets emails real attendees, so use it only for what the emulators can't do, such as real Google sign-in, App Check or production data. Copy `.env.example` to `.env` first and fill in the same Firebase config values as the GitHub secrets:

```bash
cp .env.example .env
```

### 4. First President

Admin access comes from each user's `group`, and a new deployment has no admin yet. Sign in, then set `group` to `president` on your `users` document in Firebase Console: see [Bootstrapping the first president](user-groups.md#bootstrapping-the-first-president). That account then assigns groups to everyone else from the **Admin Panel**.

## Deploy Workflow

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`):

1. Installs dependencies (root and `functions/`)
2. Typechecks, so a type error stops the deploy before anything ships
3. Builds the site with Firebase env vars from secrets
4. Authenticates to Google Cloud via the service account
5. Runs `firebase deploy` (firebase-tools pinned to major version 15) — ships hosting, Cloud Functions, Firestore rules/indexes/TTL policies, and Storage rules in a single command. Functions whose source hasn't changed are skipped, and hosting is released last so the new frontend never goes live ahead of a function it calls.

Pushes that only touch `docs/`, `README.md`, `CONTRIBUTING.md`, `Trademarks.md`, or `LICENSE` don't deploy.

You can also trigger a deployment manually from the **Actions** tab > **Deploy to Firebase** > **Run workflow**.

### Manual deploy (escape hatch)

If CI is unavailable, you can still deploy from your local machine:

```bash
npm run deploy            # full deploy (build + hosting + rules + functions + indexes + TTL)
npm run deploy:rules      # just functions, rules, indexes, and TTL — skips frontend rebuild
```

Both require `firebase login` locally.

Lockfile and Node-version rules for changing dependencies are in [CONTRIBUTING.md](../CONTRIBUTING.md#dependencies).

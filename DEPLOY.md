# Deployment

The site deploys automatically to Firebase Hosting when you push to `main` via GitHub Actions.

## First-Time Setup

### 1. Firebase Project

> **Note:** Steps 5–9 below (rules, indexes, storage, functions, TTL policies) are re-applied automatically by the GitHub Actions workflow on every push to `main`. You only need to run them manually for the initial project setup or when CI is unavailable.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values — you'll paste these into [GitHub secrets](#2-github-repository-secrets) for CI, and into [`.env`](#3-local-development) to run the dev server against production
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules** — copy the contents of [`firestore.rules`](firestore.rules) into the Firestore Rules editor
6. Deploy the required **Composite Indexes**:
   - Either click the index creation link shown in the browser error when you first use the app, **or**
   - Deploy the indexes defined in [`firestore.indexes.json`](firestore.indexes.json) with `firebase deploy --only firestore:indexes`

   Without these composite indexes, certain queries will fail with a `missing index` error.

7. Deploy **Storage Rules** — copy the contents of [`storage.rules`](storage.rules) into the Storage Rules editor, or deploy via `firebase deploy --only storage`

   The rules allow public reads under the asset folders (`avatars/`, `banners/`, `events/`, `badges/`, and so on) and deny every client write. The app doesn't depend on them: the browser never uses the Storage SDK, uploads go through Cloud Functions (the Admin SDK isn't bound by rules), and images load through tokened download URLs, which bypass rules. What the rules do is stop anyone from writing to the bucket directly.

8. Deploy **Cloud Functions** — the app uses callable Cloud Functions plus Firestore-trigger functions for all data mutations (user profile creation, admin operations, badge/event management, image uploads, ticketing, TTL-driven deletions, etc.). Without these, the entire app is non-functional:

   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```

9. Configure **Firestore TTL Policies** — the app relies on TTL-based auto-expiry for rate limiting, audit-log retention, deferred deletion of users/events/badges, cleanup of expired claim/activation codes, scan-event retention, and per-client scan quotas. Ten TTL policies are required:

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
   | `scans`                 | `expiresAt` | Scan-event retention (365 days) for QR codes                 |
   | `scanQuota`             | `expiresAt` | Per-client scan-quota windows (two windows' grace)           |

   All ten are defined as `fieldOverrides` with `"ttl": true` in [`firestore.indexes.json`](firestore.indexes.json), so they deploy with the indexes:

   ```bash
   firebase deploy --only firestore:indexes
   ```

   Each override also lists the field's ascending, descending, and array-contains indexes. An override replaces a field's default indexes rather than adding to them, so leaving those out would drop indexing on the field and break queries such as the admin Users tab's `where('deleteAt', '!=', null)`. Keep them when adding a new TTL field.

   > **Note:** Firestore TTL requires the **Blaze plan** (pay-as-you-go). It is not available on the free Spark plan.

   Without these policies, rate-limit entries and audit logs accumulate indefinitely, and deletion cooldowns will never fire the cleanup triggers.

10. Configure **outbound email (Resend)** — paid event ticket emails are delivered through **[Resend](https://resend.com)**. The `sendTicketEmails` and `scheduledMailDrain` Cloud Functions call the Resend API directly (the batch endpoint). Resend's free tier (3,000/mo, 100/day) covers the project's expected ~1,000 emails/month with headroom for event-day bursts, and its DNS setup plays cleanly with Cloudflare.

    **Step A — Set up Resend and verify `sekaibeyond.com`**

    1. Sign up at [resend.com](https://resend.com) and confirm your account email.
    2. Go to **Domains** > **Add Domain**, enter your site's domain (`sekaibeyond.com` here), and follow Resend's on-screen DNS setup instructions — it auto-detects Cloudflare and can provision the MX/SPF/DKIM/DMARC records for you via OAuth. Click **Verify DNS Records** once the dashboard shows everything green. It must be the host of `PUBLIC_ORIGIN` (see Step 12), since every email is sent from that domain.
    3. Go to **API Keys** > **Create API Key**, name it `sekaibeyond-functions`, give it **Full access**, and copy the key (starts with `re_`). You won't be able to view it again. *Sending access* isn't enough: the admin **Email Quota** tool and the send path's daily-cap check count usage by reading Resend's sent-email log (`GET /emails`), which a sending-only key is refused. With one, the tool shows usage as unavailable and the cap check falls back to its cached count. A full-access key can manage the whole Resend account, so guard it like the account password.

    **Step B — Store the API key as a Functions secret**

    The functions read the key through `defineSecret("RESEND_API_KEY")`, which resolves via **Google Secret Manager** — *not* a `.env` file. Set it once:

    ```bash
    firebase functions:secrets:set RESEND_API_KEY
    ```

    Paste the `re_…` key from Step A.3 when prompted. The secret must exist before the email functions are deployed:

    - **Manual deploy:** if the secret is missing, `firebase deploy --only functions` prompts to create it interactively.
    - **CI deploy:** the GitHub Actions workflow is non-interactive — run the command above *before* the first CI deploy of this code, or the deploy fails. CI reuses the stored secret automatically afterward; you only re-run the command to rotate the key. The deploy service account also needs the **Secret Manager Admin** role (`roles/secretmanager.admin`) — this is *not* included in **Firebase Admin** or **Cloud Functions Admin** and must be granted explicitly (see [Section 2](#2-github-repository-secrets)). Without it, the deploy fails with `403 Permission 'secretmanager.secrets.get' denied` when it reaches a secret-bound function. The deploy needs *Admin* (not just *Viewer*) because the CLI also sets an IAM binding granting the functions runtime service account access to the secret.

    The **From address** is `<prefix>@<your site's domain>`. The domain is the host of `PUBLIC_ORIGIN` (see Step 12) with any leading `www.` dropped, so it must be the domain you verified in Resend. Admins set the prefix under **Site Config > Sender Email**, and it takes effect on the next email with no deploy. While it is blank, mail goes out from `no-reply@` that domain.

    Ticket emails set no reply-to, so a reply goes to the From address. If Cloudflare Email Routing handles the domain's inbound mail, replies to `no-reply@` bounce unless a routing rule (or the catch-all) forwards that address somewhere.

    **Step C — Send a test**

    First set **Site Config > Contact Email**. The default ticket template fills `{{ contactEmail }}` from it, for the "contact us" line and its `mailto:` link, and a send is refused while the template uses it and it is blank.

    Then, after deploying Functions, send a real ticket email from the **Admin Panel**. Cross-check Resend's **Logs** tab in the dashboard, which surfaces bounces, suppressions, and DKIM failures. As a second signal, the functions cache Resend's daily usage in the `system/resendQuota` Firestore doc — a populated `confirmed` count there after a send shows the functions are reading usage back from Resend.

    > If Cloudflare Email Routing is also handling inbound mail for `sekaibeyond.com`, leave its existing MX records on the apex (`sekaibeyond.com`) untouched — Resend's MX is on the `send.` subdomain and won't conflict.

    > **Overflow queue:** sends past Resend's 100/day cap are written to a `scheduledMail` collection and drained by the `scheduledMailDrain` scheduled function every 30 minutes as quota frees up. No setup needed — it deploys with the other functions.

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
    - Local `.env` — required for `npm run dev:prod` to obtain real tokens. (`npm run dev` runs against the emulators, which skip App Check.)

    Vite inlines `VITE_*` at build time, so the bundle must be rebuilt after the secret is added or App Check will silently no-op in production.

    **Step D — Verify before enforcing**

    Deploy, then open the production site with DevTools > Network:
    - `firebaseappcheck.googleapis.com/v1/.../exchangeRecaptchaV3Token` should return **200**. A 4xx means the site key, secret, or registered domain doesn't match.
    - A Firestore request should include the `X-Firebase-AppCheck` header.

    Only once both checks pass, go to App Check > **APIs** and click **Enforce** for Firestore, Storage, and Cloud Functions.

    **Optional — Debug tokens for local development**

    For `npm run dev:prod` (or staging hosts not registered with reCAPTCHA), set `VITE_APP_CHECK_DEBUG_TOKEN=true` in `.env`. The first page load logs a debug token to the browser console; copy it into Firebase Console > App Check > Apps > **Manage debug tokens** to allow that specific token through enforced services. Set `VITE_APP_CHECK_DEBUG_TOKEN=<token>` in `.env` to reuse the same token across sessions.

12. Override `PUBLIC_ORIGIN` for forks — ticket emails from `sendTicketEmails` embed QR images served from `{PUBLIC_ORIGIN}/api/ticket-qr`, and `serveTicketQr` encodes a ticket-claim URL (`{PUBLIC_ORIGIN}/claim?ticket=X&event=Y`) into each one. Its host is also the domain every email is sent from (see Step 10), less any leading `www.`. Without this, forks will send QR codes pointing at the original site (`https://sekaibeyond.com`, the in-source default — see `functions/src/utils/config.ts`) instead of their own deployment, from a sender Resend rejects.

    The functions read `process.env.PUBLIC_ORIGIN` at runtime. Set it in a dotenv file under `functions/`:

    - **Project-scoped dotenv (recommended):** create `functions/.env.<project-id>` (e.g. `functions/.env.sekaibeyond-fc616`, suffix from `.firebaserc`) containing `PUBLIC_ORIGIN=https://your-site.example.com`. Firebase loads it only when deploying to that project, so values don't leak into other environments.
    - **Generic dotenv:** `functions/.env` applies to every project this repo deploys to.

    Then redeploy Functions so the new value is picked up:

    ```bash
    firebase deploy --only functions
    ```

    The same mechanism applies to the optional settings `RESEND_DAILY_CAP` (default 100), `SEND_CHUNK_SIZE` (default 100), `RESEND_QUEUE_CAP` (default 500), `IMPORT_MAX_ROWS` (default 1000), `MAX_UPLOAD_SIZE_MB` (default 10), and `SCAN_CLIENT_SALT`. The salt has a fallback in source, so set your own to keep the hashed scan-client keys from being reversed by someone holding both the source and a database export. `functions/.env.example` describes each one. Note that `RESEND_API_KEY` is *not* one of these — it is a Secret Manager secret, set via `firebase functions:secrets:set` (see Step 10).

13. **Maps need no setup.** The **Parking Guide** and the admin panel's maps (the Locations map, the map picker for venues and QR spots, and the QR spots map) draw [OpenFreeMap](https://openfreemap.org) tiles of OpenStreetMap data with MapLibre GL: no key, no billing, no request limit. The map picker's place search uses OpenStreetMap's [Nominatim](https://nominatim.org/release-docs/latest/api/Search/), whose usage policy allows a search when someone asks for one (at most one a second, and no search-as-you-type), which is how the picker uses it.

    > **Parking data:** lot details, UW's event-parking days and walking times come from UW Transportation Services and OpenStreetMap. The `uwParkingNightlySync` scheduled function copies them into `uwParking/current` every day at 5:30 PM Pacific; it deploys with the other functions and needs no keys. To fill it right after the first deploy, use **Force run** on its job in [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler).

    The CSP header in `firebase.json` already allows what the maps need: `https://tiles.openfreemap.org` in `img-src` and `connect-src` (tiles, fonts and icons), `https://nominatim.openstreetmap.org` in `connect-src` (place search), and `worker-src 'self'` for MapLibre's worker, which the build bundles as a same-origin file. If you add other third-party scripts, extend that header accordingly — the deploy-time `npm run update-csp-hashes` only rewrites the inline-script `sha256-` hashes inside `script-src`, preserving every other source token.

#### Firestore Indexes Explained

Firestore requires composite indexes for queries that filter on multiple fields. Each index is a sorted table covering the fields in order, allowing O(1) lookups instead of O(n) collection scans.

The app currently requires 8 composite indexes (defined in [`firestore.indexes.json`](firestore.indexes.json)):

| Collection | Fields | Purpose |
|---|---|---|
| `attendees` | `[emailSent, createdAt]` | Admin tickets panel: query unsent attendees for bulk ticket-email send |
| `badgeActivationCodes` | `[badgeId, createdAt desc]` | Admin panel: load codes for a badge |
| `records` | `[type, timestamp desc]` | Activity log by type |
| `records` | `[performedBy, timestamp desc]` | Activity log by user |
| `records` | `[type, performedBy, timestamp desc]` | Activity log filtered by type and user |
| `upcomingEvents` | `[published, startAt]` | Public listing of published upcoming events, sorted by start time |
| `users` | `[group, joinedAt desc]` | Admin panel: list users by group, newest first |
| `users` | `[group, membershipExpiresAt desc]` | Admin panel: list current members in a group, latest expiry first |

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
   - **Secret Manager Admin** (`roles/secretmanager.admin`) — required to deploy the secret-bound email functions; not covered by Firebase Admin (see [Step 10](#1-firebase-project))
   - **Cloud Scheduler Admin** (`roles/cloudscheduler.admin`) — required to create/update the Cloud Scheduler jobs behind the `scheduledMailDrain` and `uwParkingNightlySync` scheduled functions; not covered by Firebase Admin or Cloud Functions Admin. Without it, deploys that change the function's schedule fail with `403 ... lacks IAM permission "cloudscheduler.jobs.update"`.
   - **Service Account User**
5. After creating, open the service account, go to the **Keys** tab, click **Add Key** > **Create new key** > **JSON**, and download the file
6. Paste the entire file contents into the `FIREBASE_SERVICE_ACCOUNT` secret value in GitHub

### 3. Local Development

`npm run dev` runs the site against the [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite), never production. The emulators keep their own Auth accounts, Firestore data, Storage files and Cloud Functions, under `demo-sekaibeyond`, a demo project ID that can't reach any real Firebase or Google Cloud service. It needs the Firebase CLI (`npm install -g firebase-tools`) and Java 21 or later for the Firestore and Storage emulators.

```bash
npm run dev
```

In one terminal, it builds the functions, starts the Auth, Firestore, Functions and Storage emulators, and starts the site once they're up. It also rebuilds the functions as you edit them, and the emulators reload after each build.

No `.env` is needed. The site reads the committed [`.env.emulator`](.env.emulator), which takes precedence over `.env`. The Emulator UI at http://127.0.0.1:4000 shows and edits the data. When you stop `npm run dev` (Ctrl+C), the data is saved to `.emulator-data/` and loaded again on the next start. Delete that folder to start over.

**Becoming an admin.** Signing in opens the Auth emulator's account picker instead of Google's, where you can add any account. Then promote that account the way production's first president is set up (see [User Groups](#4-user-groups)): in the Emulator UI's **Firestore** tab, set `group` to `president` on your `users` document.

**What differs from production:**

- No email is sent. Resend is never called: each email is logged in the emulators' output (`Emulator, not sent: …`) and counted as sent. The log also says the emulator couldn't access `RESEND_API_KEY` from Secret Manager, which is expected.
- App Check is off. The site skips it, and the functions don't enforce it when emulated.
- Scheduled functions don't run, so `scheduledMailDrain` and `uwParkingNightlySync` are skipped. The parking guide has no lot data until an admin runs **Sync now** under **UW Parking Data** in the admin panel.
- TTL policies don't run, so an account, event or badge whose deletion was requested is never deleted. Deleting its document in the Emulator UI still runs the cleanup trigger.
- Composite indexes aren't enforced. A query missing from `firestore.indexes.json` works here but fails in production.

**Against production.** `npm run dev:prod` runs the site against the real project, using the config in `.env`. Every change it makes is live, and sending tickets emails real attendees, so use it only for what the emulators can't do, such as real Google sign-in, App Check or production data. Copy `.env.example` to `.env` first and fill in the same Firebase config values as the GitHub secrets:

```bash
cp .env.example .env
```

### 4. User Groups

The site uses a role-based group system instead of a simple admin flag. `group` is a
pure role ladder — users are assigned one of the following (lowest to highest):

| Group        | Description                                          |
|--------------|------------------------------------------------------|
| `user`       | Default for newly signed-in users                    |
| `staff`      | Staff members                                        |
| `core-staff` | Core staff — can access the admin panel              |
| `president`  | Club president — can access the admin panel          |

**Membership** is separate from `group`. It is a time-boxed attribute,
`users/{uid}.membershipExpiresAt`, and someone is a member exactly while that
timestamp is in the future. Any group can hold one, so a `president` can be a member
too, and membership never promotes or demotes anyone. Core-staff and above grant,
extend, or revoke it from the Users tab of the admin panel; every change is audited
in Records. There is no scheduled job — membership lapses by timestamp comparison.

**Bootstrapping the first president:**

1. Sign in to the site so your user document is created in Firestore
2. In Firebase Console > Firestore > `users` collection, find your document
3. Add or edit the `group` field and set it to `president`

Once the first president is set up, they can assign groups to other users through the **Admin Panel** on the site. Only `core-staff` and `president` can access the admin panel and assign groups below their own level.

## Deploy Workflow

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`):

1. Installs dependencies (root and `functions/`)
2. Typechecks, so a type error stops the deploy before anything ships
3. Builds the site with Firebase env vars from secrets
4. Authenticates to Google Cloud via the service account
5. Runs `firebase deploy` (firebase-tools pinned to major version 15) — ships hosting, Cloud Functions, Firestore rules/indexes/TTL policies, and Storage rules in a single command. Functions whose source hasn't changed are skipped, and hosting is released last so the new frontend never goes live ahead of a function it calls.

Pushes that only touch `README.md`, `DEPLOY.md`, `Trademarks.md`, or `LICENSE` don't deploy.

You can also trigger a deployment manually from the **Actions** tab > **Deploy to Firebase** > **Run workflow**.

### Lockfiles

Both `package-lock.json` and `functions/package-lock.json` are committed, and both must stay that way. The deploy workflow installs with `npm ci`, which fails without a lockfile, and `actions/setup-node` keys its npm cache on the two files. Cloud Functions deploys also run `npm ci` against `functions/package-lock.json`, and the functions runtime is much more sensitive to transitive-dep drift (native modules, Node-version-specific builds). After changing either `package.json`, run `npm install` in that directory and commit the updated lockfile alongside it.

### Node versions

CI builds on Node 26 (`node-version` in `deploy.yml`), but Cloud Functions still runs on `nodejs24` (`firebase.json`): Node 26 is only in preview on Cloud Run functions, and the Firebase CLI doesn't accept `nodejs26` yet. `functions/package.json` keeps `@types/node` at `^24` so `tsc` rejects Node APIs the deployed runtime doesn't have. When moving the functions runtime up, bump `runtime` and that `@types/node` range together.

### Manual deploy (escape hatch)

If CI is unavailable, you can still deploy from your local machine:

```bash
npm run deploy            # full deploy (build + hosting + rules + functions + indexes + TTL)
npm run deploy:rules      # just functions, rules, indexes, and TTL — skips frontend rebuild
```

Both require `firebase login` locally.
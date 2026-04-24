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

8. Deploy **Cloud Functions** — the app uses 44 callable Cloud Functions plus 4 Firestore-trigger functions for all data mutations (user profile creation, admin operations, badge/event management, image uploads, ticketing, TTL-driven deletions, etc.). Without these, the entire app is non-functional:

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

10. Install the **Firebase Trigger Email extension** — paid event ticketing relies on this extension to deliver per-attendee ticket emails. The `sendTicketEmails` Cloud Function writes documents to the `mail/{autoId}` collection; the extension picks them up and sends via SMTP.

    Outbound mail is sent through **[Resend](https://resend.com)** — its free tier (3,000/mo, 100/day) covers the project's expected ~1,000 emails/month with headroom for event-day bursts, and its DNS setup plays cleanly with Cloudflare.

    **Step A — Set up Resend and verify `sekaibeyond.com`**

    1. Sign up at [resend.com](https://resend.com) and confirm your account email.
    2. Go to **Domains** > **Add Domain**, enter `sekaibeyond.com`, and follow Resend's on-screen DNS setup instructions — it auto-detects Cloudflare and can provision the MX/SPF/DKIM/DMARC records for you via OAuth. Click **Verify DNS Records** once the dashboard shows everything green.
    3. Go to **API Keys** > **Create API Key**, name it `sekaibeyond-firebase-extension`, scope it to **Sending access** only, and copy the key (starts with `re_`). You won't be able to view it again.

    **Step B — Install the Trigger Email extension**

    Install from [firebase.google.com/products/extensions/firebase-firestore-send-email](https://firebase.google.com/products/extensions/firebase-firestore-send-email) (or via Firebase Console > Extensions > Browse). **Leave every configuration parameter at its default except the ones listed below** — don't change settings you don't understand, or the install will fail or the app will break at runtime.

    | Setting                     | Value                                                       |
    |-----------------------------|-------------------------------------------------------------|
    | Firestore Instance Location | Must match the region of the Firestore database created in Step 4. For a `nam5` database, pick **`United States (multi-region)`**. If this doesn't match the actual database region, the install fails partway through with `Database '(default)' does not exist in region '...'` and leaves stale Eventarc triggers behind that need to be cleaned up before retry. |
    | SMTP connection URI         | `smtps://resend:<your-api-key>@smtp.resend.com:465`         |
    | Default FROM address        | `no-reply@sekaibeyond.com`                                  |
    | TTL expiration              | optional — set to 7d or similar to auto-clean delivered docs |

    > The username in the SMTP URI is the literal string `resend` — not your account email. The password is the `re_…` API key from Step A.3. URL-encode the key if it contains characters Firebase warns about (it normally doesn't).

    **Step C — Send a test**

    The easiest end-to-end test is to write a test document directly to the `mail` collection in Firebase Console > **Firestore** > **Start collection** (if it doesn't exist yet) and add a document with these fields:

    ```json
    {
      "to": ["your-email@example.com"],
      "message": {
        "subject": "Resend + extension test",
        "html": "<p>If you're reading this, the pipeline works.</p>"
      }
    }
    ```

    The extension should pick it up within a few seconds and append a `delivery` map to the doc — `delivery.state: "SUCCESS"` means it was handed to Resend; anything else (`ERROR`, `RETRY`) along with `delivery.error` tells you what broke. Cross-check against Resend's **Logs** tab in the dashboard, which surfaces bounces, suppressions, and DKIM failures that the extension itself can't see.

    Once the manual test passes, trigger a real ticket email through the admin panel to confirm the production path works too.

    > If Cloudflare Email Routing is also handling inbound mail for `sekaibeyond.com`, leave its existing MX records on the apex (`sekaibeyond.com`) untouched — Resend's MX is on the `send.` subdomain and won't conflict.

    Without this extension, ticket emails will be written to Firestore but never sent.

11. Configure the `PUBLIC_ORIGIN` **Functions parameter** — `sendTicketEmails` embeds ticket-claim URLs (`{PUBLIC_ORIGIN}/claim?ticket=X&event=Y`) into the QR images it generates. Set it to your deployed site's origin (e.g. `https://your-project.web.app` or your custom domain).

    For Cloud Functions v2, params declared via `defineString` are read from a dotenv file inside `functions/`. Create `functions/.env` (applies to all projects) or `functions/.env.<project-id>` (per-project override) containing:

    ```
    PUBLIC_ORIGIN=https://your-site.example.com
    ```

    > **Prefer the project-scoped filename** (e.g. `functions/.env.sekaibeyond-fc616`, where the suffix is the Firebase project ID from `.firebaserc`). Firebase loads it only when deploying to that project and it overrides `.env`, so values don't leak into future dev/staging projects. Firebase also rejects keys starting with `FIREBASE_`, `X_GOOGLE_`, or `EXT_` in `.env` — the project-scoped file sidesteps that class of deploy failure.

    Then redeploy Functions so the new value is picked up:

    ```bash
    firebase deploy --only functions
    ```

    If unset, `PUBLIC_ORIGIN` falls back to the default baked into the code (`https://sekaibeyond.com` — see `functions/src/index.ts`). Forks that skip this step will send QR codes pointing at the original site instead of their own deployment.

#### Firestore Indexes Explained

Firestore requires composite indexes for queries that filter on multiple fields. Each index is a sorted table covering the fields in order, allowing O(1) lookups instead of O(n) collection scans.

The app currently requires 6 composite indexes (defined in [`firestore.indexes.json`](firestore.indexes.json)):

| Collection | Fields | Purpose |
|---|---|---|
| `attendees` | `[emailSent, createdAt]` | Admin tickets panel: query unsent attendees for bulk ticket-email send |
| `badgeActivationCodes` | `[badgeId, createdAt desc]` | Admin panel: load codes for a badge |
| `records` | `[type, timestamp desc]` | Activity log by type |
| `records` | `[performedBy, timestamp desc]` | Activity log by user |
| `records` | `[type, performedBy, timestamp desc]` | Activity log filtered by type and user |
| `upcomingEvents` | `[published, startAt]` | Public listing of published upcoming events, sorted by start time |

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
| `FIREBASE_SERVICE_ACCOUNT`          | Service account JSON (see below)    |

The `VITE_*` secrets are injected as build-time environment variables. `FIREBASE_SERVICE_ACCOUNT` authenticates the deploy step.

> **Note:** The `.firebasestorage.app` suffix is the default for Firebase projects created after October 2024. Older projects use `.appspot.com` — use whichever format Firebase Console shows for your bucket.

**Generating `FIREBASE_SERVICE_ACCOUNT`:**

1. Open [Google Cloud Console](https://console.cloud.google.com) and select your Firebase project
2. Go to **IAM & Admin** > **Service Accounts** > **Create Service Account**
3. Name it something like `github-actions-deploy`
4. Grant these roles:
   - **Firebase Admin** (broad, simplest), or more narrowly: **Firebase Hosting Admin**, **Cloud Functions Admin**, **Firebase Rules Admin**, **Storage Admin**
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

### Manual deploy (escape hatch)

If CI is unavailable, you can still deploy from your local machine:

```bash
npm run deploy            # full deploy (build + hosting + rules + functions + indexes)
npm run deploy:rules      # just functions, rules, and indexes — skips frontend rebuild
npm run deploy:ttl        # (re)apply Firestore TTL policies via gcloud
```

Both require `firebase login` locally.
# Deployment

The site deploys automatically to Firebase Hosting when you push to `main` via GitHub Actions.

## First-Time Setup

### 1. Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules** — copy the contents of [`firestore.rules`](firestore.rules) into the Firestore Rules editor
6. Deploy the required **Composite Indexes**:
   - Either click the index creation link shown in the browser error when you first use the app, **or**
   - Deploy the indexes defined in [`firestore.indexes.json`](firestore.indexes.json) with `firebase deploy --only firestore:indexes`

   Without these composite indexes, certain queries will fail with a `missing index` error.

7. Deploy **Storage Rules** — copy the contents of [`storage.rules`](storage.rules) into the Storage Rules editor, or deploy via `firebase deploy --only storage`

   Storage rules control access to user avatars and admin-uploaded images (event/badge images). Without deploying these, storage defaults to locked-down and all image uploads will fail.

8. Deploy **Cloud Functions** — the app uses 28 callable Cloud Functions for all data mutations (user profile creation, admin operations, badge/event management, image uploads, etc.). Without these, the entire app is non-functional:

   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```

9. Configure **Firestore TTL Policy** for rate limiting — the app uses a `rateLimits` collection with TTL-based auto-expiry. In Firebase Console, go to **Firestore** > **TTL** > **Create policy**, and set:
   - Collection: `rateLimits`
   - Field: `expiresAt`

   > **Note:** Firestore TTL requires the **Blaze plan** (pay-as-you-go). It is not available on the free Spark plan.

   Without this policy, rate-limit entries accumulate indefinitely and never get cleaned up.

#### Firestore Indexes Explained

Firestore requires composite indexes for queries that filter on multiple fields. Each index is a sorted table covering the fields in order, allowing O(1) lookups instead of O(n) collection scans.

The app currently requires 5 composite indexes (defined in [`firestore.indexes.json`](firestore.indexes.json)):

| Collection | Fields | Purpose |
|---|---|---|
| `badgeActivationCodes` | `[badgeId, createdAt desc]` | Admin panel: load codes for a badge |
| `badgeActivationCodes` | `[code, active]` | Claiming a badge with a code |
| `records` | `[type, timestamp desc]` | Activity log by type |
| `records` | `[performedBy, timestamp desc]` | Activity log by user |
| `records` | `[type, performedBy, timestamp desc]` | Activity log filtered by type and user |

### 2. GitHub Repository Secrets

Go to your repo > **Settings** > **Secrets and variables** > **Actions**, and add these secrets:

| Secret                              | Value                            |
|-------------------------------------|----------------------------------|
| `VITE_FIREBASE_API_KEY`             | Your Firebase API key            |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `your-project.firebaseapp.com`   |
| `VITE_FIREBASE_PROJECT_ID`          | Your project ID                  |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `your-project.appspot.com`       |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID                   |
| `VITE_FIREBASE_APP_ID`              | Your app ID                      |
| `FIREBASE_SERVICE_ACCOUNT`          | Service account JSON (see below) |

The `VITE_*` secrets are injected as build-time environment variables. `FIREBASE_SERVICE_ACCOUNT` authenticates the deploy step.

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
4. Runs `firebase deploy` — ships hosting, Cloud Functions, Firestore rules/indexes, and Storage rules in a single atomic deploy

You can also trigger a deployment manually from the **Actions** tab > **Deploy to Firebase** > **Run workflow**.

### Manual deploy (escape hatch)

If CI is unavailable, you can still deploy from your local machine:

```bash
npm run deploy:firebase   # full deploy (hosting + rules + functions)
npm run deploy:rules      # just rules/functions/indexes, skips frontend rebuild
```

Both require `firebase login` locally.
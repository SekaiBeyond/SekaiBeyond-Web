# Firebase App Check

The app initializes App Check with reCAPTCHA v3 to protect Firestore, Storage, and callable Functions from unauthorized clients. If App Check is enforced in Firebase Console without the steps below, all reads/writes will fail with `FirebaseError: Missing or insufficient permissions`.

## 1. Create a reCAPTCHA v3 site key

1. Go to [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) and register a new site:
   - Type: **reCAPTCHA v3**
   - Domains: add **every** domain the site is served from — e.g. `sekaibeyond.com`, `www.sekaibeyond.com`, `<project-id>.web.app`, `<project-id>.firebaseapp.com`, and any custom preview hosts. Missing domains here is the #1 cause of post-enforcement permission errors.
2. Copy the **site key** and the **secret key**.

## 2. Register the web app in Firebase App Check

1. Firebase Console > **App Check** > **Apps** > select your web app > **reCAPTCHA v3**.
2. Paste the **secret key** from step 1 and save.
3. Leave Firestore / Storage / Functions enforcement **off** until [step 4](#4-verify-before-enforcing) verifies tokens are flowing.

## 3. Wire the site key into the build

Add `VITE_RECAPTCHA_SITE_KEY=<site-key>` to:
- GitHub repo secrets (see [GitHub Repository Secrets](deploy.md#2-github-repository-secrets)) — required for production builds.
- Local `.env` — required for `npm run dev:prod` to obtain real tokens. (`npm run dev` runs against the [emulators](emulators.md), which skip App Check.)

Vite inlines `VITE_*` at build time, so the bundle must be rebuilt after the secret is added or App Check will silently no-op in production.

## 4. Verify before enforcing

Deploy, then open the production site with DevTools > Network:
- `firebaseappcheck.googleapis.com/v1/.../exchangeRecaptchaV3Token` should return **200**. A 4xx means the site key, secret, or registered domain doesn't match.
- A Firestore request should include the `X-Firebase-AppCheck` header.

Only once both checks pass, go to App Check > **APIs** and click **Enforce** for Firestore, Storage, and Cloud Functions.

## Debug tokens for local development

For `npm run dev:prod` (or staging hosts not registered with reCAPTCHA), set `VITE_APP_CHECK_DEBUG_TOKEN=true` in `.env`. The first page load logs a debug token to the browser console; copy it into Firebase Console > App Check > Apps > **Manage debug tokens** to allow that specific token through enforced services. Set `VITE_APP_CHECK_DEBUG_TOKEN=<token>` in `.env` to reuse the same token across sessions.

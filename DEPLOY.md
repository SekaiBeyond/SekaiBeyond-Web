# Deployment

The site deploys automatically to GitHub Pages when you push to `main` via GitHub Actions.

## First-Time Setup

### 1. Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules** — copy the contents of [`firestore.rules`](firestore.rules) into the Firestore Rules editor

### 2. GitHub Repository Secrets

Go to your repo > **Settings** > **Secrets and variables** > **Actions**, and add these secrets:

| Secret                              | Value                          |
|-------------------------------------|--------------------------------|
| `VITE_FIREBASE_API_KEY`             | Your Firebase API key          |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID`          | Your project ID                |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `your-project.appspot.com`     |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Your sender ID                 |
| `VITE_FIREBASE_APP_ID`              | Your app ID                    |

These are injected during the GitHub Actions build step.

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

1. Installs dependencies
2. Builds the site with Firebase env vars from secrets
3. Copies `index.html` to `404.html` (SPA fallback routing)
4. Deploys to GitHub Pages

You can also trigger a deployment manually from the **Actions** tab > **Deploy to GitHub Pages** > **Run workflow**.

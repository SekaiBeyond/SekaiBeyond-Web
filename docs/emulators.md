# Testing with the Emulators

`npm run dev` runs the site against the [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite), never production. The emulators keep their own Auth accounts, Firestore data, Storage files and Cloud Functions, under `demo-sekaibeyond`, a demo project ID that can't reach any real Firebase or Google Cloud service.

## Prerequisites

- The [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- Java 21 or later, for the Firestore and Storage emulators
- Dependencies installed in both the root and `functions/`:

  ```bash
  npm install
  npm --prefix functions install
  ```

## Running

```bash
npm run dev
```

In one terminal, it builds the functions, starts the Auth, Firestore, Functions and Storage emulators, and starts the site at http://localhost:5173 once they're up. It also rebuilds the functions as you edit them, and the emulators reload after each build.

No `.env` is needed. The site reads the committed [`.env.emulator`](../.env.emulator), which takes precedence over `.env`.

The emulators listen on these ports, set under `emulators` in [`firebase.json`](../firebase.json):

| Emulator  | Address                |
|-----------|------------------------|
| UI        | http://127.0.0.1:4000  |
| Auth      | 127.0.0.1:9099         |
| Firestore | 127.0.0.1:8080         |
| Functions | 127.0.0.1:5001         |
| Storage   | 127.0.0.1:9199         |

## Data

The Emulator UI at http://127.0.0.1:4000 shows and edits the data. When you stop `npm run dev` (Ctrl+C), the data is saved to `.emulator-data/` and loaded again on the next start. Press Ctrl+C once and let them finish: a second Ctrl+C stops the emulators without saving. Delete that folder to start over.

## Becoming an admin

Signing in opens the Auth emulator's account picker instead of Google's, where you can add any account. Then promote that account the way production's first president is set up (see [Bootstrapping the first president](user-groups.md#bootstrapping-the-first-president)): in the Emulator UI's **Firestore** tab, set `group` to `president` on your `users` document.

## What differs from production

- No email is sent. Resend is never called: each email is logged in the emulators' output (`Emulator, not sent: …`) and counted as sent. The log also says the emulator couldn't access `RESEND_API_KEY` from Secret Manager, which is expected.
- App Check is off. The site skips it, and the functions don't enforce it when emulated.
- Scheduled functions don't run, so `scheduledMailDrain` and `uwParkingNightlySync` are skipped. The parking guide has no lot data until an admin runs **Sync now** under **UW Parking Data** in the admin panel.
- TTL policies don't run, so an account, event or badge whose deletion was requested is never deleted. Deleting its document in the Emulator UI still runs the cleanup trigger.
- Composite indexes aren't enforced. A query missing from `firestore.indexes.json` works here but fails in production.

For what the emulators can't do, such as real Google sign-in, App Check or production data, `npm run dev:prod` runs the site against the real project instead. See [Local Development](deploy.md#3-local-development) for its setup, and use it with care: every change it makes is live.

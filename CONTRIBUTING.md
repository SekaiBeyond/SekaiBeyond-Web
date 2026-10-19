# Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

Test your changes with `npm run dev`, which runs the site against local Firebase emulators (see [Testing with the Emulators](docs/emulators.md)), and run `npm run typecheck` before opening the pull request: a type error stops the deploy.

## Dependencies

### Lockfiles

Both `package-lock.json` and `functions/package-lock.json` are committed, and both must stay that way. The deploy workflow installs with `npm ci`, which fails without a lockfile, and `actions/setup-node` keys its npm cache on the two files. Cloud Functions deploys also run `npm ci` against `functions/package-lock.json`, and the functions runtime is much more sensitive to transitive-dep drift (native modules, Node-version-specific builds). After changing either `package.json`, run `npm install` in that directory and commit the updated lockfile alongside it.

### Node versions

CI builds on Node 26 (`node-version` in `deploy.yml`), but Cloud Functions still runs on `nodejs24` (`firebase.json`): Node 26 is only in preview on Cloud Run functions, and the Firebase CLI doesn't accept `nodejs26` yet. `functions/package.json` keeps `@types/node` at `^24` so `tsc` rejects Node APIs the deployed runtime doesn't have. When moving the functions runtime up, bump `runtime` and that `@types/node` range together.

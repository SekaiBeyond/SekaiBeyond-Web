<p align="center">
  <img src="./public/mika.webp" alt="Sekai Beyond Logo" width="100"/>
</p>

<h1 align="center">Sekai Beyond</h1>

<p align="center">
  <strong>Official Website of Sekai Beyond</strong>
</p>

<p align="center">
  <a href="https://sekaibeyond.com">Website</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="DEPLOY.md">Deployment</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## About

This repository contains the source code for the official **Sekai Beyond** website. Built with modern web technologies, it delivers a fast, responsive, and seamless user experience.

## Tech Stack

| Technology                                    | Purpose                        |
|-----------------------------------------------|--------------------------------|
| [React](https://react.dev/)                   | UI Framework                   |
| [React Router](https://reactrouter.com/)      | Framework & Routing            |
| [TypeScript](https://www.typescriptlang.org/) | Type Safety                    |
| [Vite](https://vitejs.dev/)                   | Build Tool                     |
| [Firebase](https://firebase.google.com/)      | Auth, Firestore, Cloud Storage, Cloud Functions |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v24 or higher recommended)
- npm, yarn, pnpm, or bun

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/SekaiBeyond/SekaiBeyond-Web.git
   cd SekaiBeyond-Web
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npm run dev
   ```

4. **Open your browser**

   Navigate to [http://localhost:5173](http://localhost:5173)

## Scripts

| Command                | Description                                                       |
|------------------------|-------------------------------------------------------------------|
| `npm run dev`          | Start development server with HMR                                 |
| `npm run build`        | Build for production                                              |
| `npm run start`        | Run production server                                             |
| `npm run typecheck`    | Run TypeScript compiler check                                     |
| `npm run deploy`       | Build and deploy to Firebase                                      |
| `npm run deploy:rules` | Deploy only functions, Firestore rules/indexes, and Storage rules |
| `npm run deploy:ttl`   | Apply Firestore TTL policies via the gcloud CLI                   |

## The con page (`/con`)

Sekai Beyond Con has its own full page at `/con`, living in [`app/pages/con/`](app/pages/con).
Unlike the rest of the site it is **not** Firestore-driven — every string is a bilingual
`{ en, zh }` pair in [`app/pages/con/content.ts`](app/pages/con/content.ts), so updating
the con means editing that one file and redeploying. Most of it is still seeded with
placeholder detail (date, venue, ticket link, schedule, line-up, prices); the header
comment lists what needs replacing before an edition goes public.

A few things worth knowing before working on it:

- **Its styles are `sbc-` prefixed** ([`app/styles/con.css`](app/styles/con.css)). The page
  carries its own dark navbar and footer, whose natural class names (`.hero`, `.section`,
  `.navbar`, `.countdown-*`, `.footer-*`) all already mean something else in this folder.
  It reuses the shared brand tokens and `.btn` styles, and adds only `.sbc-btn-ghost`
  (glass, for sitting on the hero video) and `.sbc-btn-compact`.
- **The hero backdrop has three tiers**, picked at runtime in `Hero.tsx`: a self-hosted
  clip (`HERO_VIDEO.loopMp4`/`loopWebm` in `public/`), else the Bilibili embed, else a
  poster/gradient. Only the self-hosted clip loops and only it autoplays on phones —
  Bilibili's iframe has no loop parameter, is cross-origin, and mobile browsers refuse
  iframe autoplay. To turn looping on, drop a 10–20s silent cut in `public/` and set the
  paths. Under `prefers-reduced-motion: reduce` neither video mounts.
- **Anchors clear the fixed navbar** via `scroll-margin-top` on `.sbc-section`, not a
  global `scroll-padding-top`, so the main site's anchor scrolling is unaffected.
  `useHashScroll` makes `/con#tickets` work on a cold load.
- The home page's `#con` teaser (`SekaiBeyondCon.tsx`, driven by the `conEdition`
  site-config doc) links through to this page.

## Deployment

See [DEPLOY.md](DEPLOY.md) for full deployment instructions, including Firebase setup, GitHub secrets, user groups, and the deployment workflow.

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).

## Trademarks

Please see [Trademarks.md](Trademarks.md) for information regarding the use of project trademarks, logos, and branding.

---

<p align="center">
  Built with ❤️ by the <strong>Sekai Beyond</strong> team
</p>

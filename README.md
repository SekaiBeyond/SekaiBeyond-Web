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
  <a href="#documentation">Documentation</a> •
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

- [Node.js](https://nodejs.org/) (v26 or higher recommended)
- npm, yarn, pnpm, or bun
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- Java 21 or higher, for the Firestore and Storage emulators

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/SekaiBeyond/SekaiBeyond-Web.git
   cd SekaiBeyond-Web
   ```

2. **Install dependencies**

   ```bash
   npm install
   npm --prefix functions install
   ```

3. **Start the development server**

   ```bash
   npm run dev
   ```

   It starts local Firebase emulators and runs the site against them, never the production database. See [Testing with the Emulators](docs/emulators.md) for signing in as an admin and what differs from production.

4. **Open your browser**

   Navigate to [http://localhost:5173](http://localhost:5173)

## Scripts

| Command                | Description                                                       |
|------------------------|-------------------------------------------------------------------|
| `npm run dev`          | Start development server with HMR, against local emulators        |
| `npm run dev:prod`     | Start development server against production, configured in `.env` |
| `npm run build`        | Build for production                                              |
| `npm run start`        | Run production server                                             |
| `npm run typecheck`    | Run TypeScript compiler check                                     |
| `npm run deploy`       | Build and deploy to Firebase                                      |
| `npm run deploy:rules` | Deploy functions, Firestore rules/indexes/TTL, and Storage rules  |

## Documentation

| Doc                                                     | Covers                                                             |
|---------------------------------------------------------|--------------------------------------------------------------------|
| [Deployment](docs/deploy.md)                            | First-time Firebase setup, GitHub secrets, and the deploy workflow |
| [Testing with the Emulators](docs/emulators.md)         | Running the site locally against Firebase emulators                |
| [Ticket Email](docs/email.md)                           | Sending ticket emails through Resend                               |
| [App Check](docs/app-check.md)                          | reCAPTCHA v3 protection for Firestore, Storage, and Functions      |
| [Firestore Indexes and TTL Policies](docs/firestore.md) | The composite indexes and TTL policies the app needs               |
| [User Groups](docs/user-groups.md)                      | Roles, admin access, the first president, and membership           |
| [Ticket API](docs/api.md)                               | API keys, and selling tickets for paid events from another app     |

## Contributing

We welcome contributions from the community! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes, test them, and update dependencies.

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).

## Trademarks

Please see [Trademarks.md](Trademarks.md) for information regarding the use of project trademarks, logos, and branding.

---

<p align="center">
  Built with ❤️ by the <strong>Sekai Beyond</strong> team
</p>

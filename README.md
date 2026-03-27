<p align="center">
  <img src="./public/images/mika.png" alt="Sekai Beyond Logo" width="100"/>
</p>

<h1 align="center">Sekai Beyond</h1>

<p align="center">
  <strong>Official Website of Sekai Beyond</strong>
</p>

<p align="center">
  <a href="https://sekaibeyond.com">Website</a> •
  <a href="#features">Features</a> •
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
| [React Router](https://reactrouter.com/)      | Framework & SSR                |
| [TypeScript](https://www.typescriptlang.org/) | Type Safety                    |
| [TailwindCSS](https://tailwindcss.com/)       | Styling                        |
| [Vite](https://vitejs.dev/)                   | Build Tool                     |
| [Firebase](https://firebase.google.com/)      | Auth, Firestore, Cloud Storage |

## Features

- 🚀 **Server-Side Rendering (SSR)** — Fast initial page loads and SEO optimization
- ⚡ **Hot Module Replacement (HMR)** — Instant updates during development
- 📦 **Optimized Builds** — Asset bundling and optimization for production
- 🔄 **Data Loading & Mutations** — Efficient data handling with React Router
- 🔒 **TypeScript** — Full type safety out of the box
- 🎨 **TailwindCSS** — Utility-first CSS for rapid UI development
- 🔐 **Firebase Auth** — Google sign-in with role-based access control
- 🛡️ **Admin Panel** — Manage users, events, badges, and audit logs

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
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

| Command             | Description                       |
|---------------------|-----------------------------------|
| `npm run dev`       | Start development server with HMR |
| `npm run build`     | Build for production              |
| `npm run start`     | Run production server             |
| `npm run typecheck` | Run TypeScript compiler check     |
| `npm run deploy`    | Build and deploy to GitHub Pages  |

## Project Structure

```
SekaiBeyond-Web/
├── app/                       # Application source code
│   ├── components/            # Reusable UI components
│   │   └── main/              # Main page sections
│   ├── lib/                   # Firebase client & data hooks
│   ├── pages/                 # Page components (admin, profile, claim, etc.)
│   ├── routes/                # Route definitions
│   ├── app.css                # Global styles
│   ├── constants.ts           # Upcoming events & links
│   ├── root.tsx               # Root component
│   └── routes.ts              # Route configuration
├── public/                    # Static assets
│   └── images/                # Image assets & event posters
├── .env.example               # Environment variable template
├── firestore.rules            # Firestore security rules
├── storage.rules              # Cloud Storage security rules
├── package.json
├── tsconfig.json
├── react-router.config.ts     # React Router configuration
└── vite.config.ts
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for full deployment instructions, including Firebase setup, GitHub secrets, user groups, and the deployment workflow.

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Managing Events

**Upcoming events** are managed in `app/constants.ts` via the `UPCOMING_EVENTS` array. Each event is automatically hidden after its `END_AT` time passes. To add a new event:

1. Place the event poster image in `public/images/`
2. Add a new entry to the `UPCOMING_EVENTS` array in `app/constants.ts`:

```ts
{
    START_AT: new Date('2026-06-01T14:00:00'),
    END_AT: new Date('2026-06-01T18:00:00'),
    NAME: "Event Name",
    NAME_CN: "活动名称",
    DESCRIPTION: "English description of the event.",
    DESCRIPTION_CN: "活动的中文描述。",
    LOCATION: "Event Location",
    LOCATION_CN: "活动地点",
    POSTER: "/images/your_poster.png",
    // Optional fields:
    BUY_TICKET: "https://ticket-link.com",
    LEARN_MORE: "https://more-info.com",
    CUSTOM_BUTTON_TEXT: "Sign Up",
    CUSTOM_BUTTON_TEXT_CN: "报名",
    CUSTOM_BUTTON_LINK: "https://signup-link.com",
    POSTER_CREDIT: "Artist Name",
}
```

> **Note:** Events are automatically filtered out once `END_AT` has passed. A validation check ensures `END_AT` is always later than `START_AT`.

**Past events** are stored in Firestore and managed through the admin panel (`/admin`) by users with `core-staff` or `president` roles. The admin panel also handles user management, badges, and audit logging. See [DEPLOY.md](DEPLOY.md) for details on user groups and permissions.

### Development Guidelines

- Follow the existing code style
- Write meaningful commit messages
- Add tests for new features when applicable
- Update documentation as needed

## License

This project is licensed under the [AGPL-3.0 License](LICENSE).

## Trademarks

Please see [Trademarks.md](Trademarks.md) for information regarding the use of project trademarks, logos, and branding.

---

<p align="center">
  Built with ❤️ by the <strong>Sekai Beyond</strong> team
</p>

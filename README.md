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
  <a href="#deployment">Deployment</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## About

This repository contains the source code for the official **Sekai Beyond** website. Built with modern web technologies, it delivers a fast, responsive, and seamless user experience.

## Tech Stack

| Technology                                    | Purpose         |
|-----------------------------------------------|-----------------|
| [React](https://react.dev/)                   | UI Framework    |
| [React Router](https://reactrouter.com/)      | Framework & SSR |
| [TypeScript](https://www.typescriptlang.org/) | Type Safety     |
| [TailwindCSS](https://tailwindcss.com/)       | Styling         |
| [Vite](https://vitejs.dev/)                   | Build Tool      |

## Features

- 🚀 **Server-Side Rendering (SSR)** — Fast initial page loads and SEO optimization
- ⚡ **Hot Module Replacement (HMR)** — Instant updates during development
- 📦 **Optimized Builds** — Asset bundling and optimization for production
- 🔄 **Data Loading & Mutations** — Efficient data handling with React Router
- 🔒 **TypeScript** — Full type safety out of the box
- 🎨 **TailwindCSS** — Utility-first CSS for rapid UI development

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
├── app/                    # Application source code
│   ├── components/         # Reusable UI components
│   ├── pages/              # Page components
│   ├── routes/             # Route definitions
│   ├── app.css             # Global styles
│   ├── constants.ts        # Application constants
│   ├── root.tsx            # Root component
│   └── routes.ts           # Route configuration
├── public/                 # Static assets
│   └── images/             # Image assets
├── package.json
├── tsconfig.json
├── react-router.config.ts  # React Router configuration
└── vite.config.ts
```

## Deployment

The site deploys automatically to GitHub Pages when you push to `main` via GitHub Actions.

### First-Time Setup

#### 1. Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Add a **Web app** and copy the Firebase config values
3. Enable **Google sign-in** under Authentication > Sign-in method
4. Create a **Cloud Firestore** database (choose a nearby region)
5. Set Firestore **Security Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    match /users/{userId} {
      allow read: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow write: if request.auth != null && (request.auth.uid == userId || isAdmin());
    }

    match /admins/{adminId} {
      allow read: if request.auth != null && request.auth.uid == adminId;
      allow write: if false;
    }
  }
}
```

#### 2. GitHub Repository Secrets

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

#### 3. Local Development

Copy `.env.example` to `.env` and fill in the same Firebase config values:

```bash
cp .env.example .env
```

Then run `npm run dev` to start the dev server.

#### 4. Adding Admins

1. Find the user's **UID** in Firebase Console > Authentication > Users
2. In Firestore, create a document in the `admins` collection with the **Document ID** set to that UID (fields can be empty)

### Deploy Workflow

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`):

1. Installs dependencies
2. Builds the site with Firebase env vars from secrets
3. Copies `index.html` to `404.html` (SPA fallback routing)
4. Deploys to GitHub Pages

You can also trigger a deploy manually from the **Actions** tab > **Deploy to GitHub Pages** > **Run workflow**.

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Adding Upcoming Events

Upcoming events are managed in `app/constants.ts` via the `UPCOMING_EVENTS` array. Each event is automatically hidden after its `END_AT` time passes. To add a new event:

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

### Adding Past Events

Past events are managed in `app/constants.ts` via the `PAST_EVENTS` array. To add a new past event:

1. Place the event image in `public/images/events/`
2. Add a new entry to the **top** of the `PAST_EVENTS` array (most recent first):

```ts
{
    badge: "Festival",       // Short category label in English (e.g. "Gaming", "Music", "Food", "Cosplay", "Vendor")
    badgeCn: "节日",          // Category label in Chinese
    title: "Event Name",
    titleCn: "活动名称",
    date: "2026-06-01",      // Format: YYYY-MM-DD
    location: "Venue Name, University of Washington",
    description: "English description of the event.",
    descriptionCn: "活动的中文描述。",
    icon: "/images/events/your_event_image.jpg",
}
```

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

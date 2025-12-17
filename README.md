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

| Technology | Purpose |
|------------|---------|
| [React](https://react.dev/) | UI Framework |
| [React Router](https://reactrouter.com/) | Routing & SSR |
| [TypeScript](https://www.typescriptlang.org/) | Type Safety |
| [TailwindCSS](https://tailwindcss.com/) | Styling |
| [Vite](https://vitejs.dev/) | Build Tool |

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

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Build for production |
| `npm run start` | Run production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler check |

## Project Structure

```
SekaiBeyond-Web/
├── app/                    # Application source code
│   ├── components/         # Reusable UI components
│   ├── routes/             # Route components
│   └── styles/             # Global styles
├── public/                 # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

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

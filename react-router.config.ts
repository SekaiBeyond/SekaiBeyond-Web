import type { Config } from "@react-router/dev/config";

export default {
    // No server: this ships as a static SPA on Firebase Hosting, with every
    // route rewritten to /index.html (see firebase.json).
    ssr: false,
} satisfies Config;

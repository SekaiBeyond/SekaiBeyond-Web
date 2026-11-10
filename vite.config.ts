import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";

// Chrome asks for this file on any localhost page it has DevTools open on, to offer the project as a workspace. No
// route answers it, so React Router logs "No route matches URL" each time; a plain 404 here keeps it from getting that
// far.
const chromeDevtoolsProbe: Plugin = {
    name: "chrome-devtools-probe",
    apply: "serve",
    configureServer(server) {
        server.middlewares.use("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
            res.statusCode = 404;
            res.end();
        });
    },
};

export default defineConfig({
    plugins: [chromeDevtoolsProbe, reactRouter()],
    resolve: {tsconfigPaths: true}
});

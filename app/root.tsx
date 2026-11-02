import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { LanguageProvider } from "~/components/LanguageContextProvider";
import { AuthProvider } from "~/components/AuthProvider";
import { RedeemModal } from "~/components/RedeemModal";
import type { ReactNode } from "react";

// Unknown paths are still served with a 200 (the SPA fallback), so this keeps
// them out of search results.
export function meta({error}: Route.MetaArgs) {
    if (!error) return [];
    return [
        {title: isRouteErrorResponse(error) && error.status === 404 ? "Page Not Found | Sekai Beyond" : "Error | Sekai Beyond"},
        {name: "robots", content: "noindex"},
    ];
}

export function Layout({children}: {children: ReactNode}) {
    return (
        <html lang="en">
        <head>
            <meta charSet="utf-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1"/>
            <Meta/>
            <Links/>
        </head>
        <body>
        <LanguageProvider>
            <AuthProvider>
                <RedeemModal/>
                {children}
            </AuthProvider>
        </LanguageProvider>
        <ScrollRestoration/>
        <Scripts/>
        </body>
        </html>
    );
}

export default function App() {
    return <Outlet/>;
}

export function ErrorBoundary({error}: Route.ErrorBoundaryProps) {
    let message = "Oops!";
    let details = "An unexpected error occurred.";
    let stack: string | undefined;

    if (isRouteErrorResponse(error)) {
        message = error.status === 404 ? "404" : "Error";
        details =
            error.status === 404
                ? "The requested page could not be found."
                : error.statusText || details;
    } else if (import.meta.env.DEV && error instanceof Error) {
        details = error.message;
        stack = error.stack;
    }

    return (
        <main>
            <h1>{message}</h1>
            <p>{details}</p>
            {stack && (
                <pre>
          <code>{stack}</code>
        </pre>
            )}
        </main>
    );
}

/**
 * Relays the ticket API (functions/src/functions/api.ts) on api.sekaibeyond.com,
 * so a seller's server in mainland China can call it: Google's hosts, the
 * function's and Firebase Hosting's alike, aren't reliably reachable there,
 * and Cloudflare is. Spec in docs/api.md.
 *
 *   https://api.sekaibeyond.com/v1/events  ->  ${UPSTREAM}/v1/events
 *
 * A pass-through and nothing more: the key, its scopes and its rate limit are
 * all checked upstream, and nothing is cached.
 */

interface Env {
    /** Where the API is served, without a trailing slash: the Hosting route, or the function's own URL. */
    UPSTREAM: string;
}

/** Orders are a few hundred bytes; anything this size isn't one. */
const MAX_BODY_BYTES = 64 * 1024;

/** Well past a slow transaction, short of a client giving up first. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** What the API reads. Anything else a client or Cloudflare adds stays here. */
const REQUEST_HEADERS = ["authorization", "content-type", "accept", "user-agent"];

/** What the API answers with that a caller needs. Google's own headers stay behind. */
const RESPONSE_HEADERS = ["content-type", "allow", "retry-after"];

/** In the API's own error shape, so a caller handles the relay's errors like any other. */
function error(status: number, code: string, message: string): Response {
    return Response.json({error: {code, message}}, {
        status,
        headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/v1/")) return error(404, "not-found", "No such endpoint.");
        if (!env.UPSTREAM) return error(500, "internal", "The relay has no upstream configured.");

        let body: ArrayBuffer | undefined;
        if (request.method !== "GET" && request.method !== "HEAD") {
            body = await request.arrayBuffer();
            if (body.byteLength > MAX_BODY_BYTES) {
                return error(413, "payload-too-large", "The request body is too large.");
            }
        }

        const headers = new Headers();
        for (const name of REQUEST_HEADERS) {
            const value = request.headers.get(name);
            if (value !== null) headers.set(name, value);
        }

        let upstream: Response;
        try {
            upstream = await fetch(`${env.UPSTREAM}${url.pathname}${url.search}`, {
                method: request.method,
                headers,
                body,
                // A redirect would be Google's to follow, never the caller's.
                redirect: "manual",
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            });
        } catch (err) {
            const timedOut = err instanceof DOMException && err.name === "TimeoutError";
            console.error(`api-relay: ${request.method} ${url.pathname} failed`, err);
            return timedOut
                ? error(504, "upstream-timeout", "The API took too long to answer. Try again.")
                : error(502, "upstream-unavailable", "The API couldn't be reached. Try again.");
        }

        const out = new Headers({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
        for (const name of RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value !== null) out.set(name, value);
        }
        return new Response(upstream.body, {status: upstream.status, headers: out});
    },
};

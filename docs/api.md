# Ticket API

Lets another app's server read our events and sell tickets for the paid ones. Tickets sold this way go on the event's attendee list, scan at the door like any other, and show in the buyer's **My Tickets** on the site when the order carries their email. An order can also ask us to email the buyer their tickets.

**It's an admin-level API, not one for ordinary users.** A key sees events as core-staff do in the admin panel, unpublished ones included. So keys go only to our own systems and to partners' servers we trust.

The API returns everything the site itself reads and leaves the filtering to the caller. Its events are both kinds the site has, unarchived and archived, each with the site's own fields.

The code is [`functions/src/functions/api.ts`](../functions/src/functions/api.ts).

## Keys

Core-staff and above create keys in the admin panel under **Tools > API Keys**. The staff group can't see that tool, and the functions behind it (`createApiKey`, `listApiKeys`, `revokeApiKey`) refuse anyone below core-staff.

- A key is shown once, when it's made. Only its SHA-256 is stored, in `apiKeys`, which no client can read (see [`firestore.rules`](../firestore.rules)). A lost key can't be recovered: revoke it and make a new one.
- **Revoking a key deletes it.** It stops working at once and leaves the list, and Records keep its name and its first and last few characters. An expired key gets a Delete button to clear it from the list the same way.
- Each key has **scopes**: `events:read`, `tickets:write`, `tickets:read`.
- A key can be held to **specific events**, archived or not. By default it can use every event.
- Every key **expires**, after one year by default and two years at most.
- Keys belong to the club, not to whoever made them. A key keeps working after its maker steps down, and any core-staff can revoke it.
- Each key may make **120 calls a minute**.
- Creating a key, revoking one, every order placed and every email an order asks for are logged in **Records**.

**The key belongs on the seller's server only.** Never put it in a mobile app, mini-program or web page: anyone could pull it out, read everything it can, and issue themselves tickets.

## Calling it

```
https://api.sekaibeyond.com     (works from mainland China; see Relay below)
https://sekaibeyond.com/api     (everywhere else)
```

Both take the same paths and answer the same way. Every request carries the key:

```
Authorization: Bearer sbk_…
Content-Type: application/json      (POST only)
```

- **JSON in and out,** in UTF-8.
- **Timestamps** are ISO 8601 in UTC, such as `2026-11-14T18:00:00.000Z`, or `null` when not set.
- **Text fields** are `""` when not set, never `null`. Each Chinese field (ending in `Cn`) may be `""`; the site then shows the English one.
- **Fields may be added over time,** so ignore any you don't know.

## Reference

| Endpoint | Scope | What it does |
|---|---|---|
| [`GET /v1/events`](api/list-events.md) | `events:read` | List every event, archived ones included |
| [`GET /v1/events/{eventId}`](api/get-event.md) | `events:read` | Get one event, such as to check it just before taking payment |
| [`POST /v1/events/{eventId}/orders`](api/create-order.md) | `tickets:write` | Issue an order's tickets once it's paid |
| [`GET /v1/events/{eventId}/orders/{orderId}`](api/get-order.md) | `tickets:read` | Get an order, with whether each ticket has been used |

What they return:

- [The Event object](api/event.md): both kinds of event the site has, unarchived and archived, and their fields
- [The Order object](api/order.md): an order and its tickets

Prices stay in the seller's app, since events don't store them.

## Errors

Errors come in one shape:

```json
{"error": {"code": "event-ended", "message": "This event has ended."}}
```

There's one exception, which only happens when calling `sekaibeyond.com/api` directly. A body sent as `application/json` that isn't a JSON object or array never reaches the API: Google's servers turn it away with a bare HTML `400`. That covers malformed JSON and bare strings, numbers or `null`. Through `api.sekaibeyond.com`, the relay catches it first and answers `400 invalid-request` in the usual shape.

Branch on `code`. `message` is for people, and its wording may change. Each endpoint's page lists its own errors. Every endpoint can also return these:

| Status | Code | When |
|---|---|---|
| 401 | `missing-api-key` | There's no `Authorization: Bearer` header. |
| 401 | `invalid-api-key` | The key isn't one of ours, or has been revoked. |
| 401 | `api-key-expired` | The key has expired. |
| 403 | `missing-scope` | The key lacks the scope the endpoint needs. |
| 404 | `not-found` | No such endpoint. |
| 405 | `method-not-allowed` | Wrong method. The `Allow` header names the right one. |
| 429 | `rate-limited` | Over 120 calls a minute. `Retry-After` says how many seconds to wait. |
| 500 | `internal` | Something went wrong on our side. Try again. |

The relay adds these of its own, in the same shape:

| Status | Code | When |
|---|---|---|
| 400 | `invalid-request` | A body sent as `application/json` isn't a JSON object or array. |
| 413 | `payload-too-large` | The request body is over 64 KiB. |
| 502 | `upstream-unavailable` | The API couldn't be reached. |
| 504 | `upstream-timeout` | The API took over 30 seconds. |

## Relay for mainland China

The function's own URL is on Google's network, which mainland networks can't reach. A seller's server there calls `api.sekaibeyond.com` instead. That's a Cloudflare Worker, [`cloudflare/api-relay`](../cloudflare/api-relay), which passes each `/v1/*` request on to `https://sekaibeyond.com/api/v1/*`:

- **Forwarded:** only `Authorization`, `Content-Type`, `Accept`, `User-Agent` and the body.
- **Returned:** only the response's `Content-Type`, `Allow` and `Retry-After`, plus `Cache-Control: no-store`.
- **Not cached.** The key, its scopes and its rate limit are all checked by the API. The relay itself only refuses a body over 64 KiB, and a JSON body Google's servers would turn away (see [Errors](#errors)).
- **Not on `*.workers.dev`:** that's blocked in mainland China, so the relay is on its own hostname only.

Tested on 2026-10-28 from 25 mainland probes (via [Globalping](https://globalping.io)): Alibaba, Tencent and Huawei Cloud, and China Telecom, Unicom and Mobile.

| Target | Reached | Typical time |
|---|---|---|
| The relay, `api.sekaibeyond.com` | 24/25 | about 1 s; 3–4 s on two Unicom lines |
| The function's own URL | 0/25 | every probe timed out connecting |
| `sekaibeyond.com` (Firebase Hosting) | 25/25 | about 0.7 s |

Firebase Hosting answered every probe, so `sekaibeyond.com/api/v1/*` may work from the mainland too once its route is deployed. Test it then before relying on it. The relay stays the supported way in.

### Deploying it

The Firebase deploy workflow doesn't touch it, so it's deployed by hand, by anyone with access to the `sekaibeyond.com` zone on Cloudflare:

```bash
cd cloudflare/api-relay
npx -y wrangler@4 login     # once
npx -y wrangler@4 deploy
```

The first deploy creates `api.sekaibeyond.com`'s DNS record and certificate. Deploy the Firebase side first: the relay calls the `/api/v1/**` Hosting route.

To try it locally against the emulators, run `npm run dev` in one terminal, then in another:

```bash
cd cloudflare/api-relay
npx -y wrangler@4 dev --var "UPSTREAM:http://127.0.0.1:5001/demo-sekaibeyond/us-central1/api"
```

That serves it on http://localhost:8787.

### Checking it from the mainland

No key is needed to see whether the relay is reachable:

```bash
curl -i https://api.sekaibeyond.com/v1/events
```

From anywhere it can reach, that answers `401` with `missing-api-key`, which comes from the API itself, so the whole path works. To check from mainland networks, run the same URL through a mainland testing service such as [ITDOG](https://www.itdog.cn/http/), then from the app's real server with its key.

Cloudflare's plans below Enterprise serve mainland visitors from outside China, so calls can be slow at peak hours. If they're too slow, point `api.sekaibeyond.com` at a server in Hong Kong running the same pass-through instead. Nothing in the API or the seller's app changes.

## In the admin panel

An order is one attendee, tagged with the key's name. It works like a HomeTown ticket: the buyer holds these exact tickets in the seller's app, so staff can rename it, change one ticket's type, void or scan its tickets, but not re-issue or remove it. It isn't emailed from here unless the order asked for that with `sendEmail`; one that did shows as sent, queued or unsent like any other attendee, and Send Unsent and Resend Email work on it. An attendee import with the same email doesn't replace it. Archiving the event moves its orders along with every other attendee, and the API finds them there.

Refunds aren't part of the API yet. Until they are, staff void a refunded ticket in the admin panel, and the order then shows it as `voided`.

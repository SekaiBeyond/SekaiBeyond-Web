# Ticket API

Lets another app's server read our events and sell tickets for the paid ones. Tickets sold this way go on the event's attendee list, scan at the door like any other, and show in the buyer's **My Tickets** on the site when the order carries their email.

**It's an admin-level API, not one for ordinary users.** A key sees events as core-staff do in the admin panel, unpublished ones included. So keys go only to our own systems and to partners' servers we trust.

The API returns everything the site itself reads and leaves the filtering to the caller. Its events are both kinds the site has, unarchived and archived, each with the site's own fields.

The code is [`functions/src/functions/api.ts`](../functions/src/functions/api.ts).

## Keys

Core-staff and above create keys in the admin panel under **Tools > API Keys**. The staff group can't see that tool, and the functions behind it (`createApiKey`, `listApiKeys`, `revokeApiKey`) refuse anyone below core-staff.

- A key is shown once, when it's made. Only its SHA-256 is stored, in `apiKeys`, which no client can read (see [`firestore.rules`](../firestore.rules)). A lost key can't be recovered: revoke it and make a new one.
- Each key has **scopes**: `events:read`, `tickets:write`, `tickets:read`.
- A key can be held to **specific events**, archived or not. By default it can use every event.
- Every key **expires**, after one year by default and two years at most.
- Keys belong to the club, not to whoever made them. A key keeps working after its maker steps down, and any core-staff can revoke it.
- Each key may make **120 calls a minute**.
- Creating a key, revoking one, and every order placed are logged in **Records**.

**The key belongs on the seller's server only.** Never put it in a mobile app, mini-program or web page: anyone could pull it out, read everything it can, and issue themselves tickets.

## Calling it

```
https://api.sekaibeyond.com/v1/...  (works from mainland China; see Relay below)
https://sekaibeyond.com/api/v1/...  (everywhere else)
Authorization: Bearer sbk_…
Content-Type: application/json      (POST only)
```

Both take the same paths and answer the same way. The function also answers on its own URL with the paths minus `/api`.

| Endpoint | Scope | What it's for |
|---|---|---|
| `GET /api/v1/events` | `events:read` | Every event, archived ones included |
| `GET /api/v1/events/{eventId}` | `events:read` | One event, such as to check it just before taking payment |
| `POST /api/v1/events/{eventId}/orders` | `tickets:write` | Issue an order's tickets once it's paid |
| `GET /api/v1/events/{eventId}/orders/{orderId}` | `tickets:read` | An order's tickets, and whether each has been used |

### Events

The site has two kinds of event, and the API returns both, told apart by `archived`:

- **Unarchived** (`archived: false`): upcoming, on now, or ended but not yet archived. These are what tickets are sold for. Their fields are the site's upcoming-event fields.
- **Archived** (`archived: true`): staff archive an event once it's over, and it moves to the site's past events. **It keeps its ID**, so its URL and its orders' URLs keep working. Its fields are the site's past-event fields, which differ: one `date` instead of `startAt` and `endAt`, plus tags and recap links. Its tickets are read-only.

Every event is returned, free, unpublished and archived ones too. Filter on these:

- `archived`
- `published`: whether the public site shows it, as the admin panel shows every event. An unpublished event is a draft, or one just archived that staff haven't yet published to the past-events page.
- `paid`: only paid events have tickets.
- `onSale`: whether an order can be placed for it now. That's an unarchived event that's published, paid and not yet ended, the same test creating an order applies.
- `deleteAt`: set while an event waits to be deleted.

An unarchived event:

```json
{
  "id": "…",
  "archived": false,
  "onSale": true,
  "title": "Sekai Beyond Con",
  "titleCn": "彼世界动漫游戏展",
  "description": "…",
  "descriptionCn": "…",
  "location": "…",
  "locationCn": "…",
  "venueId": "…",
  "startAt": "2026-11-14T18:00:00.000Z",
  "endAt": "2026-11-15T02:00:00.000Z",
  "poster": "https://…",
  "posterCredit": "…",
  "emailHeaderBg": "https://…",
  "buyTicket": "https://…",
  "learnMore": "https://…",
  "customButtonText": "…",
  "customButtonTextCn": "…",
  "customButtonLink": "https://…",
  "published": true,
  "paid": true,
  "deleteAt": null
}
```

An archived one:

```json
{
  "id": "…",
  "archived": true,
  "onSale": false,
  "title": "…",
  "titleCn": "…",
  "description": "…",
  "descriptionCn": "…",
  "location": "…",
  "locationCn": "…",
  "venueId": "…",
  "date": "2026-11-14",
  "tagIds": ["…"],
  "icon": "…",
  "recapLink": "https://…",
  "recapLinkCn": "https://…",
  "published": true,
  "paid": true,
  "deleteAt": null
}
```

Text fields the event doesn't have come back as `""`, and timestamps as `null`. `date` is the event's day in Pacific time, as `YYYY-MM-DD`. The list wraps the events as `{"events": [...]}`, in the site's order: unarchived ones soonest first, then archived ones latest first.

Prices stay in the seller's app, since events don't store them.

### Create an order

```json
POST /api/v1/events/{eventId}/orders
{
  "orderId": "WX20261028123456",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
  "tickets": [{"type": "normal", "count": 2}, {"type": "student", "count": 1}]
}
```

- `orderId`: the seller's own order number, 1–64 letters, digits, `-` and `_`.
- `buyer.name`: required, at most 100 characters, since the door staff see it.
- `buyer.email`: optional. With it, the tickets also appear in that person's My Tickets on the site, and a scan credits their account.
- `tickets`: one or more lines of `normal`, `early-bird`, `student`, `early-bird-student` or `vip`, 1–50 tickets in all. Comp, guest and vendor tickets are given out by staff and can't be sold.

The event must be on sale (`onSale: true`). If it isn't, a **422** says why, checked in this order:

- `event-archived`
- `event-not-paid`
- `event-not-published`
- `event-ended`

It returns **201** with the order:

```json
{
  "orderId": "WX20261028123456",
  "eventId": "…",
  "createdAt": "2026-10-28T…Z",
  "updatedAt": "2026-10-28T…Z",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
  "ticketCount": 3,
  "tickets": [
    {
      "ticketId": "…uuid…",
      "type": "normal",
      "qr": "https://sekaibeyond.com/claim?ticket=…&event=…",
      "status": "valid",
      "createdAt": "2026-10-28T…Z",
      "redeemed": false,
      "redeemedAt": null,
      "voided": false
    }
  ]
}
```

**Show each ticket's `qr` as a QR code, exactly as given.** It's what the door scanner reads.

**Retries are safe.** Sending the same order again returns the tickets it already has, with a **200**, even after the event has ended or been archived. "The same" means the same buyer and the same count of each type; how the lines are split or ordered doesn't matter. The same `orderId` with anything else is a **409**. So after a timeout, send the order again rather than giving up or making a new order number.

### View an order

`GET /api/v1/events/{eventId}/orders/{orderId}` returns the same shape as creating it, whether the event is archived or not. Each ticket has:

- `status`, which sums up the flags:
  - `valid`
  - `used`
  - `voided`, by staff in the admin panel
- the flags themselves:
  - `redeemed`, with `redeemedAt`: scanned at the door
  - `voided`

A ticket scanned and then voided reads `voided`, with `redeemed` still `true`. `updatedAt` moves whenever anything about the order changes, whether a scan, a void or a staff edit, so it's what to compare when checking for changes.

There's no list of a buyer's orders. The seller's app already knows which orders each of its users placed.

## Errors

```json
{"error": {"code": "event-ended", "message": "This event has ended."}}
```

| Status | Codes |
|---|---|
| 400 | `invalid-request`: a missing or malformed field, which the message names |
| 401 | `missing-api-key`, `invalid-api-key`, `api-key-revoked`, `api-key-expired` |
| 403 | `missing-scope`, `event-not-allowed` |
| 404 | `not-found` (no such endpoint), `event-not-found`, `order-not-found` |
| 405 | `method-not-allowed`, with an `Allow` header |
| 409 | `order-conflict` |
| 422 | `event-archived`, `event-not-paid`, `event-not-published`, `event-ended`, `unknown-ticket-type` |
| 429 | `rate-limited`, with a `Retry-After` header in seconds |
| 500 | `internal`: try again |

The relay adds three errors of its own, in the same shape:

| Status | Codes |
|---|---|
| 413 | `payload-too-large`: a request body over 64 KiB |
| 502 | `upstream-unavailable`: the API couldn't be reached |
| 504 | `upstream-timeout`: the API took over 30 seconds |

## Relay for mainland China

`sekaibeyond.com` and the function's own URL both resolve to Google addresses, which mainland networks can't reach reliably. So a seller's server there calls `api.sekaibeyond.com` instead. That's a Cloudflare Worker, [`cloudflare/api-relay`](../cloudflare/api-relay), which passes each `/v1/*` request on to `https://sekaibeyond.com/api/v1/*`:

- **Forwarded:** only `Authorization`, `Content-Type`, `Accept`, `User-Agent` and the body.
- **Returned:** only the response's `Content-Type`, `Allow` and `Retry-After`, plus `Cache-Control: no-store`.
- **Not cached,** and it checks nothing itself. The key, its scopes and its rate limit are all checked by the API.
- **Not on `*.workers.dev`:** that's blocked in mainland China, so the relay is on its own hostname only.

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

An order is one attendee, tagged with the key's name. It works like a HomeTown ticket: the buyer holds these exact tickets in the seller's app, so staff can rename it, change one ticket's type, void or scan its tickets, but not re-issue or remove it. It's never emailed from here, and an attendee import with the same email doesn't replace it. Archiving the event moves its orders along with every other attendee, and the API finds them there.

Refunds aren't part of the API yet. Until they are, staff void a refunded ticket in the admin panel, and the order then shows it as `voided`.

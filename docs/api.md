# Ticket API

Lets another app's server sell tickets for our paid events. Tickets sold this way go on the event's attendee list, scan at the door like any other, and show in the buyer's **My Tickets** on the site when the order carries their email.

The code is [`functions/src/functions/api.ts`](../functions/src/functions/api.ts).

## Keys

Core-staff and above create keys in the admin panel under **Tools > API Keys**. The staff group can't see that tool, and the functions behind it (`createApiKey`, `listApiKeys`, `revokeApiKey`) refuse anyone below core-staff.

- A key is shown once, when it's made. Only its SHA-256 is stored, in `apiKeys`, which no client can read (see [`firestore.rules`](../firestore.rules)). A lost key can't be recovered: revoke it and make a new one.
- Each key has **scopes**: `events:read`, `tickets:write`, `tickets:read`.
- A key can be held to **specific events**. By default it can use every paid event.
- Every key **expires**, after one year by default and two years at most.
- Keys belong to the club, not to whoever made them. A key keeps working after its maker steps down, and any core-staff can revoke it.
- Each key may make **120 calls a minute**.
- Creating a key, revoking one, and every order placed are logged in **Records**.

**The key belongs on the seller's server only.** Never put it in a mobile app, mini-program or web page: anyone can pull it out of one and issue themselves tickets.

## Calling it

```
https://sekaibeyond.com/api/v1/...
Authorization: Bearer sbk_…
Content-Type: application/json      (POST only)
```

The function also answers on its own URL with the same paths minus `/api`. A relay in front of it can do the same, such as a Cloudflare Worker on `api.sekaibeyond.com` for servers in mainland China, which can't reach Google's hosts.

| Endpoint | Scope | What it's for |
|---|---|---|
| `GET /api/v1/events` | `events:read` | List the paid events on sale |
| `GET /api/v1/events/{eventId}` | `events:read` | Check one event just before taking payment |
| `POST /api/v1/events/{eventId}/orders` | `tickets:write` | Issue an order's tickets once it's paid |
| `GET /api/v1/events/{eventId}/orders/{orderId}` | `tickets:read` | An order's tickets, and whether each has been used |

### Events

An event is **on sale** while it's published, paid and not yet ended. The list endpoint returns only those. The single-event endpoint also returns a paid event that has ended, with `onSale: false`. An unpublished or free event is a 404.

```json
{
  "id": "…",
  "title": "Sekai Beyond Con",
  "titleCn": "彼世界动漫游戏展",
  "startAt": "2026-11-14T18:00:00.000Z",
  "endAt": "2026-11-15T02:00:00.000Z",
  "location": "…",
  "locationCn": "…",
  "poster": "https://…",
  "onSale": true
}
```

The list wraps them as `{"events": [...]}`, soonest first. Prices stay in the seller's app, since events don't store them.

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

It returns **201** with the order:

```json
{
  "orderId": "WX20261028123456",
  "eventId": "…",
  "createdAt": "2026-10-28T…Z",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
  "tickets": [
    {
      "ticketId": "…uuid…",
      "type": "normal",
      "qr": "https://sekaibeyond.com/claim?ticket=…&event=…",
      "status": "valid",
      "usedAt": null
    }
  ]
}
```

**Show each ticket's `qr` as a QR code, exactly as given.** It's what the door scanner reads.

**Retries are safe.** Sending the same order again returns the tickets it already has, with a **200**, even after the event has ended. "The same" means the same buyer and the same count of each type; how the lines are split or ordered doesn't matter. The same `orderId` with anything else is a **409**. So after a timeout, send the order again rather than giving up or making a new order number.

### View an order

`GET /api/v1/events/{eventId}/orders/{orderId}` returns the same shape as creating it, with each ticket's `status` now:

- `valid`
- `used`, with `usedAt`
- `voided`, by staff in the admin panel

There's no list of a buyer's orders. The seller's app already knows which orders each of its users placed.

## Errors

```json
{"error": {"code": "event-not-on-sale", "message": "Tickets for this event aren't on sale."}}
```

| Status | Codes |
|---|---|
| 400 | `invalid-request`: a missing or malformed field, which the message names |
| 401 | `missing-api-key`, `invalid-api-key`, `api-key-revoked`, `api-key-expired` |
| 403 | `missing-scope`, `event-not-allowed` |
| 404 | `not-found` (no such endpoint), `event-not-found`, `order-not-found` |
| 405 | `method-not-allowed`, with an `Allow` header |
| 409 | `order-conflict` |
| 422 | `event-not-on-sale`, `unknown-ticket-type` |
| 429 | `rate-limited`, with a `Retry-After` header in seconds |
| 500 | `internal`: try again |

## In the admin panel

An order is one attendee, tagged with the key's name. It works like a HomeTown ticket: the buyer holds these exact tickets in the seller's app, so staff can rename it, change one ticket's type, void or scan its tickets, but not re-issue or remove it. It's never emailed from here, and an attendee import with the same email doesn't replace it.

Refunds aren't part of the API yet. Until they are, staff void a refunded ticket in the admin panel, and the order then shows it as `voided`.

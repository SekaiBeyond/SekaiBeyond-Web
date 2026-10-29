# Create an order

```
POST /v1/events/{eventId}/orders
```

Scope: `tickets:write` · [← Ticket API](../api.md)

Issues the tickets for an order once the buyer has paid. They go on the event's attendee list, scan at the door like any other, and show in the buyer's **My Tickets** on the site when the order carries their email. The order can also ask for them to be emailed to the buyer: see [Emailing the tickets](#emailing-the-tickets).

**Retrying is safe.** Sending the same order again returns the tickets it already has, with a 200, even after the event has ended or been archived. "The same" means the same `orderId` from the same seller (see [Keys](../api.md#keys)), buyer and count of each type; how the lines are split or ordered doesn't matter, and nor does `sendEmail`: the first request's choice stands, and a retry never sends the email again. So after a timeout, send the order again rather than giving up or making a new order number.

## Path parameters

| Name | Type | Description |
|---|---|---|
| `eventId` | string | The event's ID. It must be on sale (`onSale: true` on the [Event](event.md)). An unpublished event can be, so a test event can take orders without showing on the site. |

## Body

| Field | Type | Required | Description |
|---|---|---|---|
| `orderId` | string | Yes | Your own order number, 1–64 letters, digits, `-` and `_`. It names the order from then on. Order numbers are per seller ID, so another app's order with the same number is a different order. |
| `buyer` | object | Yes | Who bought the tickets: |
| `buyer.name` | string | Yes | Their name, at most 100 characters. Door staff see it. |
| `buyer.email` | string | No | Their email. With it, the tickets also show in that person's My Tickets on the site once the event is published, and a scan credits their account. |
| `tickets` | object[] | Yes | One or more lines, 1–50 tickets in all: |
| `tickets[].type` | string | Yes | `normal`, `early-bird`, `student`, `early-bird-student` or `vip`. Comp, guest and vendor tickets are given out by staff and can't be sold. |
| `tickets[].count` | number | Yes | How many of that type, at least 1. |
| `sendEmail` | boolean | No | `true` to have us email the tickets to `buyer.email`, which it then needs. Default `false`: your app delivers them. See [Emailing the tickets](#emailing-the-tickets). |

## Returns

**201** with the new [Order](order.md), or **200** with the existing one when this is a retry.

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `invalid-request` | A field is missing or malformed, and the message names it, or `sendEmail` is `true` without `buyer.email`. Or the body isn't a JSON object; sent straight to `sekaibeyond.com/api`, that gets a bare HTML 400 instead (see [Errors](../api.md#errors)). |
| 403 | `event-not-allowed` | The key is held to other events. |
| 404 | `event-not-found` | No event has this ID. |
| 409 | `order-conflict` | You already have an order with this `orderId`, with different contents. |
| 422 | `event-archived` | The event has been archived. |
| 422 | `event-not-paid` | The event is free, so it has no tickets. |
| 422 | `event-ended` | The event has ended. |
| 422 | `event-pending-deletion` | Staff have asked to delete the event (its `deleteAt` is set). Deleting it would delete its orders too. |
| 422 | `unknown-ticket-type` | A line's `type` isn't one that can be sold. |
| 422 | `no-template` | `sendEmail` is `true`, but staff haven't saved this event's ticket email yet. |
| 422 | `no-contact-email` | `sendEmail` is `true`, and the event's ticket email shows the club's contact email, which isn't set. |

An event that fails more than one of the four event checks gets the first one listed. A malformed body is reported before anything about the event, and the two email checks after it. None of these issue any tickets. Plus the ones every endpoint can return: see [Errors](../api.md#errors).

## Example

```bash
curl https://api.sekaibeyond.com/v1/events/k3Xq9VbLm2PzR8TaYw4N/orders \
  -H "Authorization: Bearer $SEKAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "WX20261028123456",
    "buyer": {"name": "李明", "email": "liming@qq.com"},
    "tickets": [{"type": "normal", "count": 1}, {"type": "student", "count": 1}],
    "sendEmail": true
  }'
```

```json
{
  "orderId": "WX20261028123456",
  "eventId": "k3Xq9VbLm2PzR8TaYw4N",
  "createdAt": "2026-10-28T09:12:44.311Z",
  "updatedAt": "2026-10-28T09:12:44.402Z",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
  "emailStatus": "sent",
  "ticketCount": 2,
  "tickets": [
    {
      "ticketId": "3f0c1e9a-5b7d-4c2e-9a41-7d8e2b6f1c05",
      "type": "normal",
      "qr": "https://sekaibeyond.com/claim?ticket=3f0c1e9a-5b7d-4c2e-9a41-7d8e2b6f1c05&event=k3Xq9VbLm2PzR8TaYw4N",
      "status": "valid",
      "createdAt": "2026-10-28T09:12:44.311Z",
      "redeemed": false,
      "redeemedAt": null,
      "voided": false
    },
    {
      "ticketId": "b81d4f62-0e3a-4a9c-8f17-2c5b9e7d3a10",
      "type": "student",
      "qr": "https://sekaibeyond.com/claim?ticket=b81d4f62-0e3a-4a9c-8f17-2c5b9e7d3a10&event=k3Xq9VbLm2PzR8TaYw4N",
      "status": "valid",
      "createdAt": "2026-10-28T09:12:44.311Z",
      "redeemed": false,
      "redeemedAt": null,
      "voided": false
    }
  ]
}
```

**Show each ticket's `qr` as a QR code, exactly as given.** That's what the door scanner reads.

## Emailing the tickets

With `sendEmail: true`, we email the buyer their tickets: the event's ticket email, the same one staff send from the admin panel, with a QR code for each ticket. The codes are the same tickets as each `qr` in the reply, so the buyer can use either, and your app can still show them too.

- **It's sent before the reply comes back,** and the Order's `emailStatus` says what happened: `sent`, `queued`, `unsent` or `unconfirmed`.
- **We send at most 100 emails a day,** shared with staff sends. Past that, or when our email provider asks us to slow down, the email is `queued`, and goes out as room opens, checked every 30 minutes.
- **`unsent` means it didn't go,** because our email provider refused it, or the queue was full as well. Staff can send it from the admin panel. [Get the order](get-order.md) later to see whether it has gone.
- **`unconfirmed` means we don't know yet.** Either the first request is still sending it, which is what a retry made meanwhile reads, or our email provider didn't answer within 10 seconds, so it may or may not have gone. Staff check with the buyer and send it if it didn't arrive, rather than risk sending it twice.
- **The order is placed either way,** since the buyer has paid. Don't place it again to retry the email: a retry returns the same order and never sends.

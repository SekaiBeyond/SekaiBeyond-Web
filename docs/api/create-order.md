# Create an order

```
POST /v1/events/{eventId}/orders
```

Scope: `tickets:write` · [← Ticket API](../api.md)

Issues the tickets for an order once the buyer has paid. They go on the event's attendee list, scan at the door like any other, and show in the buyer's **My Tickets** on the site when the order carries their email.

**Retrying is safe.** Sending the same order again returns the tickets it already has, with a 200, even after the event has ended or been archived. "The same" means the same `orderId`, buyer and count of each type; how the lines are split or ordered doesn't matter. So after a timeout, send the order again rather than giving up or making a new order number.

## Path parameters

| Name | Type | Description |
|---|---|---|
| `eventId` | string | The event's ID. It must be on sale (`onSale: true` on the [Event](event.md)). |

## Body

| Field | Type | Required | Description |
|---|---|---|---|
| `orderId` | string | Yes | Your own order number, 1–64 letters, digits, `-` and `_`. It names the order from then on. |
| `buyer` | object | Yes | Who bought the tickets: |
| `buyer.name` | string | Yes | Their name, at most 100 characters. Door staff see it. |
| `buyer.email` | string | No | Their email. With it, the tickets also show in that person's My Tickets on the site, and a scan credits their account. |
| `tickets` | object[] | Yes | One or more lines, 1–50 tickets in all: |
| `tickets[].type` | string | Yes | `normal`, `early-bird`, `student`, `early-bird-student` or `vip`. Comp, guest and vendor tickets are given out by staff and can't be sold. |
| `tickets[].count` | number | Yes | How many of that type, at least 1. |

## Returns

**201** with the new [Order](order.md), or **200** with the existing one when this is a retry.

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `invalid-request` | A field is missing or malformed. The message names it. |
| 403 | `event-not-allowed` | The key is held to other events. |
| 404 | `event-not-found` | No event has this ID. |
| 409 | `order-conflict` | This `orderId` is already taken by an order with different contents. |
| 422 | `event-archived` | The event has been archived. |
| 422 | `event-not-paid` | The event is free, so it has no tickets. |
| 422 | `event-not-published` | The event isn't published. |
| 422 | `event-ended` | The event has ended. |
| 422 | `unknown-ticket-type` | A line's `type` isn't one that can be sold. |

An event that fails more than one of the four event checks gets the first one listed. A malformed body is reported before anything about the event. Plus the ones every endpoint can return: see [Errors](../api.md#errors).

## Example

```bash
curl https://api.sekaibeyond.com/v1/events/k3Xq9VbLm2PzR8TaYw4N/orders \
  -H "Authorization: Bearer $SEKAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "WX20261028123456",
    "buyer": {"name": "李明", "email": "liming@qq.com"},
    "tickets": [{"type": "normal", "count": 1}, {"type": "student", "count": 1}]
  }'
```

```json
{
  "orderId": "WX20261028123456",
  "eventId": "k3Xq9VbLm2PzR8TaYw4N",
  "createdAt": "2026-10-28T09:12:44.311Z",
  "updatedAt": "2026-10-28T09:12:44.311Z",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
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

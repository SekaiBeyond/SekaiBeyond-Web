# The Order object

What [Create an order](create-order.md) and [Get an order](get-order.md) return. [← Ticket API](../api.md)

An order is one buyer's tickets for one event, placed with the seller's own order number. It stays readable after its event is archived.

## Fields

| Field | Type | Description |
|---|---|---|
| `orderId` | string | The seller's order number, as sent when the order was created. |
| `eventId` | string | The event the tickets are for. |
| `createdAt` | string | When the order was placed. |
| `updatedAt` | string | When anything about the order last changed: a scan, a void, a staff edit or its email going out. Compare it to tell whether to look again. |
| `buyer` | object | Who bought the tickets: |
| `buyer.name` | string | Their name, as sent, unless staff have since changed it. |
| `buyer.email` | string | Their email, lowercased, or `""` if none was sent. |
| `emailStatus` | string | Whether we've emailed the buyer their tickets. `not-requested` when the order didn't ask (no `sendEmail: true`); otherwise `sent`, `queued` (past the daily cap, going out as room opens) or `unsent` (not sent: staff can send it from the admin panel). See [Emailing the tickets](create-order.md#emailing-the-tickets). |
| `ticketCount` | number | How many tickets the order holds, voided ones included. |
| `tickets` | Ticket[] | The tickets, grouped by type in this order: `normal`, `early-bird`, `student`, `early-bird-student`, `vip`. |

## The Ticket object

| Field | Type | Description |
|---|---|---|
| `ticketId` | string | The ticket's ID, a UUID. |
| `type` | string | The ticket type: one of the types sold (`normal`, `early-bird`, `student`, `early-bird-student`, `vip`). Staff can change a ticket's type in the admin panel to any of the site's types, which adds `Comp Ticket`, `guest` and `vendor`. |
| `qr` | string | What to show as the ticket's QR code, exactly as given. It's a link for staff: the door scanner reads it, and a signed-in staff member opening it admits the ticket. It isn't a page for the buyer. |
| `status` | string | `valid`, `used` or `voided`. It sums up the flags below: a ticket scanned and then voided is `voided`. |
| `createdAt` | string | When the ticket was issued. |
| `redeemed` | boolean | Whether it has been scanned at the door. Staff can undo a scan, which makes it `false` again. |
| `redeemedAt` | string or null | When it was scanned, or `null`. |
| `voided` | boolean | Whether staff have voided it, such as for a refund. A voided ticket doesn't get in. |

## Example

```json
{
  "orderId": "WX20261028123456",
  "eventId": "k3Xq9VbLm2PzR8TaYw4N",
  "createdAt": "2026-10-28T09:12:44.311Z",
  "updatedAt": "2026-11-14T18:31:02.907Z",
  "buyer": {"name": "李明", "email": "liming@qq.com"},
  "emailStatus": "not-requested",
  "ticketCount": 2,
  "tickets": [
    {
      "ticketId": "3f0c1e9a-5b7d-4c2e-9a41-7d8e2b6f1c05",
      "type": "normal",
      "qr": "https://sekaibeyond.com/claim?ticket=3f0c1e9a-5b7d-4c2e-9a41-7d8e2b6f1c05&event=k3Xq9VbLm2PzR8TaYw4N",
      "status": "used",
      "createdAt": "2026-10-28T09:12:44.311Z",
      "redeemed": true,
      "redeemedAt": "2026-11-14T18:31:02.907Z",
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

# Get an order

```
GET /v1/events/{eventId}/orders/{orderId}
```

Scope: `tickets:read` · [← Ticket API](../api.md)

Returns an order placed through the API, with each ticket's status: whether it has been scanned at the door or voided by staff. It works whether or not the event has been archived.

There's no list of a buyer's orders. The seller's app already knows which orders each of its users placed. To check for changes, compare the order's `updatedAt`, which moves on any scan, void or staff edit.

## Path parameters

| Name | Type | Description |
|---|---|---|
| `eventId` | string | The event the order is for. |
| `orderId` | string | Your order number, as sent to [Create an order](create-order.md). |

## Returns

**200** with the [Order](order.md).

## Errors

| Status | Code | When |
|---|---|---|
| 403 | `event-not-allowed` | The key is held to other events. |
| 404 | `event-not-found` | No event has this ID. |
| 404 | `order-not-found` | The event has no order placed through the API with this number. |

Plus the ones every endpoint can return: see [Errors](../api.md#errors).

## Example

```bash
curl https://api.sekaibeyond.com/v1/events/k3Xq9VbLm2PzR8TaYw4N/orders/WX20261028123456 \
  -H "Authorization: Bearer $SEKAI_API_KEY"
```

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

# Get an event

```
GET /v1/events/{eventId}
```

Scope: `events:read` · [← Ticket API](../api.md)

Returns one event, archived or not. Call it just before taking payment to check that `onSale` is still `true`.

## Path parameters

| Name | Type | Description |
|---|---|---|
| `eventId` | string | The event's ID, from [List events](list-events.md). |

## Returns

**200** with the [Event](event.md).

## Errors

| Status | Code | When |
|---|---|---|
| 403 | `event-not-allowed` | The key is held to other events. |
| 404 | `event-not-found` | No event has this ID. |

Plus the ones every endpoint can return: see [Errors](../api.md#errors).

## Example

```bash
curl https://api.sekaibeyond.com/v1/events/k3Xq9VbLm2PzR8TaYw4N \
  -H "Authorization: Bearer $SEKAI_API_KEY"
```

```json
{
  "id": "k3Xq9VbLm2PzR8TaYw4N",
  "archived": false,
  "onSale": true,
  "title": "Sekai Beyond Con 2026",
  "titleCn": "彼世界动漫游戏展 2026",
  "description": "Our yearly convention.\nCosplay, vendors and stage shows.",
  "descriptionCn": "我们一年一度的漫展。\nCosplay、摊位和舞台表演。",
  "location": "HUB Ballroom",
  "locationCn": "HUB 宴会厅",
  "venueId": "hub",
  "published": true,
  "paid": true,
  "deleteAt": null,
  "startAt": "2026-11-14T18:00:00.000Z",
  "endAt": "2026-11-15T02:00:00.000Z",
  "poster": "https://firebasestorage.googleapis.com/v0/b/…/o/upcoming-events%2F…",
  "posterCredit": "Mika",
  "emailHeaderBg": "",
  "buyTicket": "https://sekaibeyond.com/con",
  "learnMore": "",
  "customButtonText": "",
  "customButtonTextCn": "",
  "customButtonLink": ""
}
```

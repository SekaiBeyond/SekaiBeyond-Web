# List events

```
GET /v1/events
```

Scope: `events:read` · [← Ticket API](../api.md)

Returns every event: unarchived and archived, free and paid, published or not. Filter on the [Event](event.md) flags (`archived`, `published`, `paid`, `onSale`, `deleteAt`) for what you need. A key held to certain events gets only those.

## Parameters

None.

## Returns

**200** with an object holding the events:

| Field | Type | Description |
|---|---|---|
| `events` | [Event](event.md)[] | Unarchived events first, soonest first, then archived ones, latest first. That's the order the site lists them in. |

## Errors

Only the ones every endpoint can return: see [Errors](../api.md#errors).

## Example

```bash
curl https://api.sekaibeyond.com/v1/events \
  -H "Authorization: Bearer $SEKAI_API_KEY"
```

```json
{
  "events": [
    {
      "id": "k3Xq9VbLm2PzR8TaYw4N",
      "archived": false,
      "onSale": true,
      "title": "Sekai Beyond Con 2026",
      "titleCn": "彼世界动漫游戏展 2026",
      "…": "the rest of the unarchived fields"
    },
    {
      "id": "aB7cD8eF9gH0iJ1kL2mN",
      "archived": true,
      "onSale": false,
      "title": "Spring Game Night",
      "titleCn": "春季游戏之夜",
      "…": "the rest of the archived fields"
    }
  ]
}
```

Every field is listed in [The Event object](event.md).

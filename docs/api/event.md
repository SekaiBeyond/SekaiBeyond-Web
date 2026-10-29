# The Event object

What [List events](list-events.md) and [Get an event](get-event.md) return. [← Ticket API](../api.md)

The site has two kinds of event, told apart by `archived`:

- **Unarchived** (`archived: false`): upcoming, on now, or over but not yet archived. Tickets are sold for these.
- **Archived** (`archived: true`): staff archive an event once it's over, and it moves to the site's past events. **It keeps its ID**, so its URLs and its orders' URLs keep working. Its tickets become read-only.

The two kinds share some fields and differ in the rest, the same way the site stores them.

## Fields on both kinds

| Field | Type | Description |
|---|---|---|
| `id` | string | The event's ID. It doesn't change when the event is archived. |
| `archived` | boolean | Whether the event has been archived. |
| `onSale` | boolean | Whether an order can be placed for it now. True only for an unarchived event that's paid and not yet ended. An unpublished event can be on sale, so check `published` too before offering it to the public. |
| `title` | string | English title. |
| `titleCn` | string | Chinese title. When it's `""`, the site shows `title` instead. |
| `description` | string | English description, plain text. It may contain line breaks. |
| `descriptionCn` | string | Chinese description. When it's `""`, the site shows `description` instead. |
| `location` | string | English location, such as a room or building. |
| `locationCn` | string | Chinese location. |
| `venueId` | string | The ID of the event's venue on the site's map and parking guide, or `""` for none. Venues aren't in the API yet. |
| `published` | boolean | Whether the public site shows the event. An unpublished event is a draft, or one just archived that staff haven't yet published to the past-events page. |
| `paid` | boolean | Whether the event has tickets. Free events don't. |
| `deleteAt` | string or null | When the event is due to be deleted, if staff have asked to delete it. Deletion waits 48 hours and can be cancelled. `null` otherwise. |

## Fields on an unarchived event

| Field | Type | Description |
|---|---|---|
| `startAt` | string or null | When the event starts. |
| `endAt` | string or null | When it ends. Orders close at this time. |
| `poster` | string | URL of the poster image, or `""`. |
| `posterCredit` | string | Who made the poster, or `""`. |
| `emailHeaderBg` | string | URL of the header image on our ticket emails, or `""`. |
| `buyTicket` | string | URL behind the site's **Get Tickets** button, or `""` for none. |
| `learnMore` | string | URL behind the site's **Learn More** button, or `""` for none. |
| `customButtonText` | string | English label of an extra button the site shows. |
| `customButtonTextCn` | string | Its Chinese label. |
| `customButtonLink` | string | Its URL, or `""` when there's no extra button. |

## Fields on an archived event

| Field | Type | Description |
|---|---|---|
| `date` | string | The day it took place, as `YYYY-MM-DD` in Pacific time. |
| `tagIds` | string[] | IDs of the event's tags on the site, such as "Workshop". Tags aren't in the API yet. |
| `icon` | string | URL of the event's photo on the past-events page, or `""`. |
| `recapLink` | string | URL of a recap post, or `""`. |
| `recapLinkCn` | string | URL of a Chinese recap post, or `""`. |

## Examples

An unarchived event:

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

An archived one:

```json
{
  "id": "aB7cD8eF9gH0iJ1kL2mN",
  "archived": true,
  "onSale": false,
  "title": "Spring Game Night",
  "titleCn": "春季游戏之夜",
  "description": "Board games and rhythm games.",
  "descriptionCn": "桌游和音游。",
  "location": "Mary Gates Hall 241",
  "locationCn": "Mary Gates Hall 241",
  "venueId": "",
  "published": true,
  "paid": false,
  "deleteAt": null,
  "date": "2026-04-18",
  "tagIds": ["gameNight"],
  "icon": "https://firebasestorage.googleapis.com/v0/b/…/o/events%2F…",
  "recapLink": "",
  "recapLinkCn": "https://www.xiaohongshu.com/…"
}
```

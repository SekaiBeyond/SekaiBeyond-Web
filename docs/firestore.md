# Firestore Indexes and TTL Policies

Both are defined in [`firestore.indexes.json`](../firestore.indexes.json) and deploy together, on every push to `main` or by hand:

```bash
firebase deploy --only firestore:indexes
```

## Composite indexes

Firestore requires composite indexes for queries that filter on multiple fields. Each index is a sorted table covering the fields in order, allowing O(1) lookups instead of O(n) collection scans. Without them, those queries fail with a `missing index` error. When one is missing, the browser error also links to a page that creates it.

The emulators don't enforce them, so a query missing from `firestore.indexes.json` works under `npm run dev` but fails in production.

The app currently requires 8 composite indexes:

| Collection | Fields | Purpose |
|---|---|---|
| `attendees` | `[emailSent, createdAt]` | Admin tickets panel: query unsent attendees for bulk ticket-email send |
| `badgeActivationCodes` | `[badgeId, createdAt desc]` | Admin panel: load codes for a badge |
| `records` | `[type, timestamp desc]` | Activity log by type |
| `records` | `[performedBy, timestamp desc]` | Activity log by user |
| `records` | `[type, performedBy, timestamp desc]` | Activity log filtered by type and user |
| `upcomingEvents` | `[published, startAt]` | Public listing of published upcoming events, sorted by start time |
| `users` | `[group, joinedAt desc]` | Admin panel: list users by group, newest first |
| `users` | `[group, membershipExpiresAt desc]` | Admin panel: list current members in a group, latest expiry first |

## TTL policies

The app relies on TTL-based auto-expiry for rate limiting, audit-log retention, deferred deletion of users/events/badges, cleanup of expired claim/activation codes, scan-event retention, and per-client scan quotas. Ten TTL policies are required:

| Collection              | Field       | Purpose                                                     |
|-------------------------|-------------|-------------------------------------------------------------|
| `rateLimits`            | `expiresAt` | Clean up rate-limit windows                                 |
| `records`               | `expiresAt` | Audit-log retention (30 days)                               |
| `claimCodes`            | `expiresAt` | Auto-expire event claim codes past their active window      |
| `badgeActivationCodes`  | `expiresAt` | Auto-expire badge activation codes past their active window |
| `users`                 | `deleteAt`  | 48h cooldown for account deletion                           |
| `pastEvents`            | `deleteAt`  | 48h cooldown for past-event deletion                        |
| `upcomingEvents`        | `deleteAt`  | 48h cooldown for upcoming-event deletion                    |
| `badges`                | `deleteAt`  | 48h cooldown for badge deletion                             |
| `scans`                 | `expiresAt` | Scan-event retention (365 days) for QR codes                 |
| `scanQuota`             | `expiresAt` | Per-client scan-quota windows (two windows' grace)           |

All ten are defined as `fieldOverrides` with `"ttl": true`. Each override also lists the field's ascending, descending, and array-contains indexes. An override replaces a field's default indexes rather than adding to them, so leaving those out would drop indexing on the field and break queries such as the admin Users tab's `where('deleteAt', '!=', null)`. Keep them when adding a new TTL field.

> **Note:** Firestore TTL requires the **Blaze plan** (pay-as-you-go). It is not available on the free Spark plan.

Without these policies, rate-limit entries and audit logs accumulate indefinitely, and deletion cooldowns will never fire the cleanup triggers.

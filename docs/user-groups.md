# User Groups

The site uses a role-based group system instead of a simple admin flag. `group` is a
pure role ladder — users are assigned one of the following (lowest to highest):

| Group        | Description                                          |
|--------------|------------------------------------------------------|
| `user`       | Default for newly signed-in users                    |
| `staff`      | Staff members                                        |
| `core-staff` | Core staff — can access the admin panel              |
| `president`  | Club president — can access the admin panel          |

Only `core-staff` and `president` can access the admin panel, where they assign groups below their own level to other users.

## Bootstrapping the first president

A new deployment has no one who can open the admin panel, so the first `president` is set by hand:

1. Sign in to the site so your user document is created in Firestore
2. In Firebase Console > Firestore > `users` collection, find your document
3. Add or edit the `group` field and set it to `president`

Once the first president is set up, they can assign groups to other users through the **Admin Panel** on the site. Under `npm run dev`, set it in the Emulator UI instead (see [Becoming an admin](emulators.md#becoming-an-admin)).

## Membership

**Membership** is separate from `group`. It is a time-boxed attribute,
`users/{uid}.membershipExpiresAt`, and someone is a member exactly while that
timestamp is in the future. Any group can hold one, so a `president` can be a member
too, and membership never promotes or demotes anyone. Core-staff and above grant,
extend, or revoke it from the Users tab of the admin panel; every change is audited
in Records. There is no scheduled job — membership lapses by timestamp comparison.

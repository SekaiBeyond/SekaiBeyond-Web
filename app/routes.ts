import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("con", "routes/convention.tsx"),
    route("profile", "routes/profile.tsx"),
    route("admin", "routes/admin.tsx"),
    route("claim", "routes/claim.tsx"),
    route("policy", "routes/policy.tsx"),
    // Where to get help after sexual assault or harassment: UW's services, then the club's officers.
    route("support", "routes/support.tsx"),
    // Where the "This wasn't me" link in an email-changed notice lands.
    route("undo-email", "routes/undoEmail.tsx"),
    // Where a registered app, such as SKBY Manager, sends people to sign in with their account here.
    route("authorize", "routes/authorize.tsx"),
    // Short URL printed on physical passport stickers for easy manual entry.
    route("p/:passportId", "routes/passport.tsx"),
    route("qr", "routes/qr.tsx"),
    route("qr/expired", "routes/qrExpired.tsx"),
    // Wildcard keeps a single map instance mounted across venue, event, and lot sub-routes.
    route("parking/*", "routes/parking.tsx"),
] satisfies RouteConfig;

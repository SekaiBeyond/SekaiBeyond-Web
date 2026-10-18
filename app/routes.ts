import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("con", "routes/con.tsx"),
    route("profile", "routes/profile.tsx"),
    route("admin", "routes/admin.tsx"),
    route("claim", "routes/claim.tsx"),
    route("policy", "routes/policy.tsx"),
    // Short URL printed on physical passport stickers for easy manual entry.
    route("p/:passportId", "routes/passport.tsx"),
    route("qr", "routes/qr.tsx"),
    route("qr/expired", "routes/qrExpired.tsx"),
    // Wildcard keeps a single map instance mounted across venue, event, and lot sub-routes.
    route("parking/*", "routes/parking.tsx"),
] satisfies RouteConfig;

import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("con", "routes/con.tsx"),
    route("profile", "routes/profile.tsx"),
    route("admin", "routes/admin.tsx"),
    route("claim", "routes/claim.tsx"),
    route("policy", "routes/policy.tsx"),
    // The single URL printed on every passport sticker. Short on purpose: it is
    // typed by hand when a sticker is too scuffed to scan.
    route("p/:passportId", "routes/passport.tsx"),
    route("qr", "routes/qr.tsx"),
    route("qr/expired", "routes/qrExpired.tsx"),
    // `/parking/venue/<venue id>` opens the guide on a venue, `/parking/lot/<lot code>` on a UW lot, and
    // `/parking/event/<event id>` on an event, with `/lot/<lot code>` after it for a lot. One route, so
    // the guide (and its map) stays put as the address follows it.
    route("parking/*", "routes/parking.tsx"),
] satisfies RouteConfig;

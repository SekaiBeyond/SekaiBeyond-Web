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
    route("parking/:eventId", "routes/parking.tsx"),
] satisfies RouteConfig;

import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("con", "routes/convention.tsx"),
    route("profile", "routes/profile.tsx"),
    route("admin", "routes/admin.tsx"),
    route("claim", "routes/claim.tsx"),
    route("policy", "routes/policy.tsx"),
    route("support", "routes/support.tsx"),
    route("undo-email", "routes/undoEmail.tsx"),
    route("undo-app-link", "routes/undoAppLink.tsx"),
    route("authorize", "routes/authorize.tsx"),
    route("p/:passportId", "routes/passport.tsx"),
    route("qr", "routes/qr.tsx"),
    route("qr/expired", "routes/qrExpired.tsx"),
    route("parking/*", "routes/parking.tsx"),
] satisfies RouteConfig;

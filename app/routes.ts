import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("profile", "routes/profile.tsx"),
    route("admin", "routes/admin.tsx"),
    route("claim", "routes/claim.tsx"),
    route("policy", "routes/policy.tsx"),
    route("qr", "routes/qr.tsx"),
    route("parking/:eventId", "routes/parking.tsx"),
] satisfies RouteConfig;

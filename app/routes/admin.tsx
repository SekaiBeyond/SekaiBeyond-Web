import type { Route } from "./+types/admin";
import { unlistedMeta } from "~/lib/seo";
import { AdminPage } from "~/pages/admin/index";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Admin | Sekai Beyond", "Admin management panel");
}

export default function Admin() {
    return <AdminPage/>;
}

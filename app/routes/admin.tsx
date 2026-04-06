import type { Route } from "./+types/admin";
import { AdminPage } from "~/pages/admin/index";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Admin | Sekai Beyond"},
        {name: "description", content: "Admin management panel"},
    ];
}

export default function Admin() {
    return <AdminPage/>;
}

import type { Route } from "./+types/admin-labels";
import { AdminLabelsPage } from "~/pages/admin-labels";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Manage Labels | Sekai Beyond"},
        {name: "description", content: "Manage event labels"},
    ];
}

export default function AdminLabels() {
    return <AdminLabelsPage/>;
}

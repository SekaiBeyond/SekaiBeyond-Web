import type { Route } from "./+types/support";
import { pageMeta } from "~/lib/seo";
import { SupportPage } from "~/pages/support";

export function meta({}: Route.MetaArgs) {
    return pageMeta({
        title: "Sexual Assault & Harassment Support | Sekai Beyond",
        description: "Where Sekai Beyond members can get help after sexual assault or harassment: the University of Washington's support and reporting services, and how to reach a club officer.",
        path: "/support",
    });
}

export default function Support() {
    return <SupportPage/>;
}

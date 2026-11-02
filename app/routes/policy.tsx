import type { Route } from "./+types/policy";
import { pageMeta } from "~/lib/seo";
import { PolicyPage } from "~/pages/policy";

export function meta({}: Route.MetaArgs) {
    return pageMeta({
        title: "Policy | Sekai Beyond",
        description: "Sekai Beyond's policies and terms.",
        path: "/policy",
    });
}

export default function Policy() {
    return <PolicyPage/>;
}

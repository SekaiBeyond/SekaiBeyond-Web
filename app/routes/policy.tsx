import type { Route } from "./+types/policy";
import { PolicyPage } from "~/pages/policy";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Policy | Sekai Beyond"},
        {name: "description", content: "Sekai Beyond policies and terms"},
    ];
}

export default function Policy() {
    return <PolicyPage/>;
}

import type { Route } from "./+types/claim";
import { ClaimPage } from "~/pages/claim";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Claim Badge | Sekai Beyond"},
        {name: "description", content: "Claim your event attendance badge"},
    ];
}

export default function Claim() {
    return <ClaimPage/>;
}

import type { Route } from "./+types/claim";
import { ClaimPage } from "~/pages/claim";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Check In | Sekai Beyond"},
        {name: "description", content: "Check in at a Sekai Beyond event"},
    ];
}

export default function Claim() {
    return <ClaimPage/>;
}

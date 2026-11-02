import type { Route } from "./+types/claim";
import { unlistedMeta } from "~/lib/seo";
import { ClaimPage } from "~/pages/claim";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Check In | Sekai Beyond", "Check in at a Sekai Beyond event");
}

export default function Claim() {
    return <ClaimPage/>;
}

import type { Route } from "./+types/passport";
import { unlistedMeta } from "~/lib/seo";
import { PassportPage } from "~/pages/passport";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Passport | Sekai Beyond", "A Sekai Beyond membership passport");
}

export default function Passport() {
    return <PassportPage/>;
}

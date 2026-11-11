import type { Route } from "./+types/authorize";
import { unlistedMeta } from "~/lib/seo";
import { AuthorizePage } from "~/pages/authorize";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Sign In with Sekai Beyond | Sekai Beyond");
}

export default function Authorize() {
    return <AuthorizePage/>;
}

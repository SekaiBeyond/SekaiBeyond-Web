import type { Route } from "./+types/managerSignIn";
import { unlistedMeta } from "~/lib/seo";
import { ManagerSignInPage } from "~/pages/managerSignIn";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Sign In to SKBY Manager | Sekai Beyond");
}

export default function ManagerSignIn() {
    return <ManagerSignInPage/>;
}

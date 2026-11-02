import type { Route } from "./+types/qr";
import { unlistedMeta } from "~/lib/seo";
import { QrRedirectPage } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Redirecting... | Sekai Beyond");
}

export default function QrRoute() {
    return <QrRedirectPage/>;
}

import type { Route } from "./+types/qrLegacy";
import { LegacyQrRedirect } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Redirecting... | Sekai Beyond"},
        {name: "robots", content: "noindex, nofollow"}
    ];
}

// Legacy printed codes carry url/event/expires inline; redirectQr forwards them
// here so the existing client-side resolution still handles them.
export default function QrLegacyRoute() {
    return <LegacyQrRedirect/>;
}

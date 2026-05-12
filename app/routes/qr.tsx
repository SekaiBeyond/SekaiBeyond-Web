import type { Route } from "./+types/qr";
import { QrRedirectPage } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Redirecting... | Sekai Beyond"},
        {name: "robots", content: "noindex, nofollow"}
    ];
}

export default function QrRoute() {
    return <QrRedirectPage/>;
}

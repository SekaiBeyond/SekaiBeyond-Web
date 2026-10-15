import type { Route } from "./+types/qrExpired";
import { useSearchParams } from "react-router";
import { ExpiredCard } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "QR Code | Sekai Beyond"},
        {name: "robots", content: "noindex, nofollow"}
    ];
}

// Where redirectQr sends expired or invalid codes; only this rare case boots the
// SPA.
export default function QrExpiredRoute() {
    const [searchParams] = useSearchParams();
    return <ExpiredCard isError={searchParams.get("error") === "1"}/>;
}

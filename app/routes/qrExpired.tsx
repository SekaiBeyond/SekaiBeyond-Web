import type { Route } from "./+types/qrExpired";
import { useSearchParams } from "react-router";
import { ExpiredCard } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "QR Code | Sekai Beyond"},
        {name: "robots", content: "noindex, nofollow"}
    ];
}

// Where redirectQr sends scanners when a managed code is expired/invalid — the
// fast path stays a pure server 302 and only the (rare) failure case boots the SPA.
export default function QrExpiredRoute() {
    const [searchParams] = useSearchParams();
    return <ExpiredCard isError={searchParams.get("error") === "1"}/>;
}

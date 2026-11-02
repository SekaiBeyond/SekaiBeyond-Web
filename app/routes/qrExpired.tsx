import type { Route } from "./+types/qrExpired";
import { unlistedMeta } from "~/lib/seo";
import { useSearchParams } from "react-router";
import { ExpiredCard } from "~/pages/qrRedirect";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("QR Code | Sekai Beyond");
}

export default function QrExpiredRoute() {
    const [searchParams] = useSearchParams();
    return <ExpiredCard isError={searchParams.get("error") === "1"}/>;
}

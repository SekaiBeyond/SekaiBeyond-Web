import type { Route } from "./+types/parking";
import { pageMeta } from "~/lib/seo";
import { ParkingGuide } from "~/pages/parking";

export function meta({}: Route.MetaArgs) {
    return pageMeta({
        title: "Parking Guide | Sekai Beyond ✨ 彼世界",
        description: "Where to park for Sekai Beyond events on the University of Washington campus in Seattle, with the closest lots to each venue.",
        // Every /parking/* view is the same guide, so each names this one as canonical.
        path: "/parking",
    });
}

export default function Parking() {
    return <ParkingGuide/>;
}

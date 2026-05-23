import type { Route } from "./+types/parking";
import { ParkingGuide } from "~/pages/ParkingGuide";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Parking Guide – Sekai Beyond ✨ 彼世界"},
        {name: "description", content: "Find parking near our event venue on the UW campus."},
    ];
}

export default function Parking() {
    return <ParkingGuide/>;
}

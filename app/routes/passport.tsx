import type { Route } from "./+types/passport";
import { PassportPage } from "~/pages/passport";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Passport | Sekai Beyond"},
        {name: "description", content: "A Sekai Beyond membership passport"},
        {name: "robots", content: "noindex, nofollow"},
    ];
}

export default function Passport() {
    return <PassportPage/>;
}

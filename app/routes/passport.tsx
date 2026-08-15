import type { Route } from "./+types/passport";
import { PassportPage } from "~/pages/passport";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Passport | Sekai Beyond"},
        {name: "description", content: "A Sekai Beyond membership passport"},
        // A passport page is a person's page reached from a physical sticker.
        // It stays out of search results even though anyone holding the sticker
        // can open it.
        {name: "robots", content: "noindex, nofollow"},
    ];
}

export default function Passport() {
    return <PassportPage/>;
}

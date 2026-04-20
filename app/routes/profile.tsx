import type { Route } from "./+types/profile";
import { ProfilePage } from "~/pages/profile";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Profile | Sekai Beyond"},
        {name: "description", content: "Your Sekai Beyond profile and badge collection"},
    ];
}

export default function Profile() {
    return <ProfilePage/>;
}

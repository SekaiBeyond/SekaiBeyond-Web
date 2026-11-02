import type { Route } from "./+types/profile";
import { unlistedMeta } from "~/lib/seo";
import { ProfilePage } from "~/pages/profile";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Profile | Sekai Beyond", "Your Sekai Beyond profile and badge collection");
}

export default function Profile() {
    return <ProfilePage/>;
}

import type { Route } from "./+types/home";
import { pageMeta } from "~/lib/seo";
import { Welcome } from "~/pages/welcome";

export function meta({}: Route.MetaArgs) {
    return pageMeta({
        title: "Sekai Beyond ✨ 彼世界 | UW Anime, Gaming & Cosplay Club",
        description: "Sekai Beyond (彼世界) is an anime, gaming and cosplay club at the University of Washington in Seattle, with game nights, idol performances, maid cafés and Sekai Beyond Con.",
        path: "/",
        keywords: "anime club, University of Washington, UW, Seattle, cosplay, idol performance, anime nation, maid cafe, convention, anime events, J-pop, student organization, Sekai Beyond Con, 彼世界, 动漫社, rso",
    });
}

export default function Home() {
    return <Welcome/>;
}

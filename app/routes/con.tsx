import type { Route } from "./+types/con";
import { pageMeta } from "~/lib/seo";
import { ConPage } from "~/pages/con";

export function meta({}: Route.MetaArgs) {
    return pageMeta({
        title: "Sekai Beyond Con ✨ 彼世界动漫游戏展 | Anime Convention at UW",
        description: "Sekai Beyond Con (彼世界动漫游戏展) is an anime convention at the University of Washington in Seattle: a day of stage performances, artist alley, cosplay and games.",
        path: "/con",
        keywords: "Sekai Beyond Con, 彼世界动漫游戏展, anime convention, Seattle anime con, University of Washington, UW, cosplay, artist alley, J-pop, idol performance, doujin, 漫展",
    });
}

export default function Con() {
    return <ConPage/>;
}

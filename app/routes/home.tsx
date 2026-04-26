import type { Route } from "./+types/home";
import { Welcome } from "~/pages/welcome";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Sekai Beyond ✨ 彼世界"},
        {name: "description", content: "Where Anime Dreams Find Their Home!"},
        {
            name: "keywords",
            content: "anime club, University of Washington, UW, Seattle, cosplay, idol performance, anime nation, maid cafe, convention, anime events, J-pop, student organization, Sekai Beyond Con, 彼世界, 动漫社, rso"
        },
    ];
}

export default function Home() {
    return <Welcome/>;
}

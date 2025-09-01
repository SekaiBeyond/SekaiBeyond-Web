import type { Route } from "./+types/con";
import { Con } from "~/pages/con";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "SEKAI CON 2025 ✨ 彼世界动漫游戏展"},
        {
            name: "description",
            content: "One of the Biggest Pacific Northwest's Student Anime Conventions - October 11, 2025 at University of Washington"
        },
    ];
}

export default function ConPage() {
    return <Con/>;
}
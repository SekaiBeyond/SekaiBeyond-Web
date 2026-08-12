import type { Route } from "./+types/con";
import { ConPage } from "~/pages/con";

export function meta({}: Route.MetaArgs) {
    return [
        {title: "Sekai Beyond Con ✨ 彼世界漫展"},
        {
            name: "description",
            content: "Sekai Beyond Con — a day of stage performances, artist alley, cosplay, and games at the University of Washington."
        },
        {
            name: "keywords",
            content: "Sekai Beyond Con, 彼世界漫展, anime convention, Seattle anime con, University of Washington, UW, cosplay, artist alley, J-pop, idol performance, doujin, 漫展"
        },
    ];
}

export default function Con() {
    return <ConPage/>;
}

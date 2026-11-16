import type { Route } from "./+types/undoAppLink";
import { unlistedMeta } from "~/lib/seo";
import { UndoAppLinkPage } from "~/pages/undoAppLink";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Undo App Link | Sekai Beyond");
}

export default function UndoAppLink() {
    return <UndoAppLinkPage/>;
}

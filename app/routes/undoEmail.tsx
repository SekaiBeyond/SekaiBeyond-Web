import type { Route } from "./+types/undoEmail";
import { unlistedMeta } from "~/lib/seo";
import { UndoEmailPage } from "~/pages/undoEmail";

export function meta({}: Route.MetaArgs) {
    return unlistedMeta("Undo Email Change | Sekai Beyond");
}

export default function UndoEmail() {
    return <UndoEmailPage/>;
}

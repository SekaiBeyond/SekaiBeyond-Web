import type { MetaDescriptor } from "react-router";

/** The live site's origin, for canonical links. */
const SITE_URL = "https://sekaibeyond.com";

interface PageMetaOptions {
    title: string;
    description: string;
    /** The page's own path, for its canonical URL, e.g. "/" or "/con". */
    path: string;
    keywords?: string;
}

/**
 * A public page's title, description and canonical link. React Router uses only
 * the deepest route's meta, so each route returns all of it.
 */
export function pageMeta({title, description, path, keywords}: PageMetaOptions): MetaDescriptor[] {
    return [
        {title},
        {name: "description", content: description},
        ...(keywords ? [{name: "keywords", content: keywords}] : []),
        {tagName: "link", rel: "canonical", href: SITE_URL + path},
    ];
}

/** A page kept out of search results: signed-in, per-person, or one-off. */
export function unlistedMeta(title: string, description?: string): MetaDescriptor[] {
    return [
        {title},
        ...(description ? [{name: "description", content: description}] : []),
        {name: "robots", content: "noindex, nofollow"},
    ];
}

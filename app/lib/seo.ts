import type { MetaDescriptor } from "react-router";

const SITE_URL = "https://sekaibeyond.com";

interface PageMetaOptions {
    title: string;
    description: string;
    path: string;
    keywords?: string;
}

export function pageMeta({title, description, path, keywords}: PageMetaOptions): MetaDescriptor[] {
    return [
        {title},
        {name: "description", content: description},
        ...(keywords ? [{name: "keywords", content: keywords}] : []),
        {tagName: "link", rel: "canonical", href: SITE_URL + path},
    ];
}

export function unlistedMeta(title: string, description?: string): MetaDescriptor[] {
    return [
        {title},
        ...(description ? [{name: "description", content: description}] : []),
        {name: "robots", content: "noindex, nofollow"},
    ];
}

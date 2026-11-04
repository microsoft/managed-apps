const MAX_CACHED_DOCUMENTS = 100;
const documentCache = new Map<string, ChildNode[]>();

export function getRichTextNodes(value: string): ChildNode[] | null {
  const cached = documentCache.get(value);
  if (cached) {
    documentCache.delete(value);
    documentCache.set(value, cached);
    return cached;
  }
  if (typeof DOMParser === "undefined") return null;

  const document = new DOMParser().parseFromString(value, "text/html");
  const nodes = Array.from(document.body.childNodes);
  documentCache.set(value, nodes);
  if (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = documentCache.keys().next().value;
    if (oldest !== undefined) documentCache.delete(oldest);
  }
  return nodes;
}

export function prepareRichText(value: string, isHtml: boolean): void {
  if (isHtml) getRichTextNodes(value);
}

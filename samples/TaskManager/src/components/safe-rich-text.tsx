import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { safeUrl } from "@/lib/safe-url";
import { getRichTextNodes } from "@/lib/rich-text-document-cache";

function safeImageUrl(value: string | null): string | undefined {
  const candidate = safeUrl(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function renderNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const tag = element.localName.toLowerCase();
  if (
    ["script", "style", "iframe", "object", "embed", "form", "input"].includes(
      tag,
    )
  ) {
    return null;
  }

  const tableStructure = ["table", "thead", "tbody", "tr"].includes(tag);
  const children = Array.from(element.childNodes)
    .filter(
      (child) =>
        !tableStructure ||
        child.nodeType !== Node.TEXT_NODE ||
        Boolean(child.textContent?.trim()),
    )
    .map((child, index) => renderNode(child, `${key}-${index}`));

  switch (tag) {
    case "br":
      return <br key={key} />;
    case "p":
      return (
        <p key={key} className="mb-2 last:mb-0">
          {children}
        </p>
      );
    case "div":
      return <div key={key}>{children}</div>;
    case "strong":
    case "b":
      return <strong key={key}>{children}</strong>;
    case "em":
    case "i":
      return <em key={key}>{children}</em>;
    case "u":
      return <u key={key}>{children}</u>;
    case "s":
    case "strike":
      return <s key={key}>{children}</s>;
    case "ul":
      return (
        <ul key={key} className="my-2 list-disc space-y-1 pl-5">
          {children}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="my-2 list-decimal space-y-1 pl-5">
          {children}
        </ol>
      );
    case "li":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return (
        <blockquote key={key} className="my-2 border-l-4 border-[#808080] pl-2">
          {children}
        </blockquote>
      );
    case "pre":
      return (
        <pre key={key} className="my-2 overflow-x-auto bg-[#dfdfdf] p-2 font-mono">
          {children}
        </pre>
      );
    case "code":
      return (
        <code key={key} className="bg-[#dfdfdf] px-1 font-mono">
          {children}
        </code>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return (
        <div key={key} className="mb-1 mt-2 font-bold">
          {children}
        </div>
      );
    case "a": {
      const href = safeUrl(element.getAttribute("href"));
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-bold text-[#000080] underline"
        >
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      );
    }
    case "img":
    case "image": {
      const src = safeImageUrl(
        element.getAttribute("src") ??
          element.getAttribute("data-src") ??
          element.getAttribute("data-original") ??
          element.getAttribute("href") ??
          element.getAttribute("xlink:href"),
      );
      return src ? (
        <img
          key={key}
          src={src}
          alt={element.getAttribute("alt") ?? ""}
          loading="eager"
          className="my-2 max-h-[60dvh] max-w-full border border-[#808080] object-contain"
        />
      ) : null;
    }
    case "picture":
    case "figure":
      return (
        <span key={key} className="block">
          {children}
        </span>
      );
    case "table":
      return (
        <table key={key} className="my-2 w-full border-collapse">
          {children}
        </table>
      );
    case "thead":
      return <thead key={key}>{children}</thead>;
    case "tbody":
      return <tbody key={key}>{children}</tbody>;
    case "tr":
      return <tr key={key}>{children}</tr>;
    case "th":
      return (
        <th key={key} className="border border-[#808080] bg-[#dfdfdf] px-2 py-1 text-left">
          {children}
        </th>
      );
    case "td":
      return (
        <td key={key} className="border border-[#808080] px-2 py-1 align-top">
          {children}
        </td>
      );
    case "hr":
      return <hr key={key} className="my-2 border-0 border-t border-[#808080]" />;
    default:
      return <span key={key}>{children}</span>;
  }
}

export function SafeRichText({
  value,
  isHtml,
  className,
}: {
  value: string;
  isHtml: boolean;
  className?: string;
}) {
  const content = useMemo(() => {
    if (!isHtml) return value;
    const nodes = getRichTextNodes(value);
    if (!nodes) return value;
    return nodes.map((node, index) => renderNode(node, `rich-${index}`));
  }, [isHtml, value]);

  return (
    <div
      className={cn(
        "min-w-0 overflow-x-auto",
        isHtml ? "whitespace-normal" : "whitespace-pre-wrap",
        className,
      )}
    >
      {content}
    </div>
  );
}

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useMemo } from 'react';

interface MarkdownBodyProps {
  content: string;
  className?: string;
  /** Original line content for rendering suggestion diffs. */
  originalLine?: string;
  /** Line number for suggestion display. */
  lineNumber?: number;
}

/** Renders a ```suggestion code block as a GitHub-style diff. */
function SuggestionBlock({
  suggestion,
  originalLine,
  lineNumber,
}: {
  suggestion: string;
  originalLine?: string;
  lineNumber?: number;
}) {
  const lineNo = lineNumber ?? '';
  // Strip trailing newline from suggestion content
  const suggestedContent = suggestion.replace(/\n$/, '');

  return (
    <div className="suggestion-block">
      <div className="suggestion-block__header">Suggested change</div>
      <table className="suggestion-block__diff">
        <tbody>
          {originalLine != null && (
            <tr className="suggestion-block__line suggestion-block__line--del">
              <td className="suggestion-block__lineno">{lineNo}</td>
              <td className="suggestion-block__marker">-</td>
              <td className="suggestion-block__code">{originalLine}</td>
            </tr>
          )}
          <tr className="suggestion-block__line suggestion-block__line--add">
            <td className="suggestion-block__lineno">{lineNo}</td>
            <td className="suggestion-block__marker">+</td>
            <td className="suggestion-block__code">{suggestedContent}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a markdown string as formatted HTML.
 * Handles GitHub-flavored markdown and ```suggestion blocks.
 */
export function MarkdownBody({ content, className, originalLine, lineNumber }: MarkdownBodyProps) {
  // Split content into segments: regular markdown and suggestion blocks
  const segments = useMemo(() => {
    const parts: Array<{ type: 'markdown' | 'suggestion'; text: string }> = [];
    const regex = /```suggestion\r?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      // Add any markdown before this suggestion
      if (match.index > lastIndex) {
        parts.push({ type: 'markdown', text: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'suggestion', text: match[1] });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining markdown after last suggestion
    if (lastIndex < content.length) {
      parts.push({ type: 'markdown', text: content.slice(lastIndex) });
    }

    return parts;
  }, [content]);

  const components: Components = {
    // Open links in new tab
    a: ({ children, href, ...props }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    ),
  };

  return (
    <div className={`markdown-body${className ? ` ${className}` : ''}`}>
      {segments.map((seg, i) =>
        seg.type === 'suggestion' ? (
          <SuggestionBlock
            key={i}
            suggestion={seg.text}
            originalLine={originalLine}
            lineNumber={lineNumber}
          />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}

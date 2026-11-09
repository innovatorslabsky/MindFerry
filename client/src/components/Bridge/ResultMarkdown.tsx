import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import type { AnchorHTMLAttributes } from 'react';
import type { Components } from 'react-markdown';

const SAFE_LINK = /^https?:\/\//i;

function ResultLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href || !SAFE_LINK.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
      {children}
    </a>
  );
}

/**
 * Anything an image could fetch is a request the agent's text makes from this browser, so images
 * are not drawn. The alt text, if any, stays as plain text.
 */
function ResultImage({ alt }: { alt?: string }) {
  return alt ? <span>{alt}</span> : null;
}

const COMPONENTS: Components = { a: ResultLink, img: ResultImage };

/**
 * An agent's result as Markdown. It is written by software that reads the open web, so it is
 * treated as untrusted: raw HTML is never rendered, images are dropped, and only http(s) links
 * are links.
 */
export default function ResultMarkdown({ text }: { text: string }) {
  return (
    <div
      className="text-text-primary prose-sm [&_code]:bg-surface-secondary [&_pre]:bg-surface-secondary max-w-none space-y-2 text-sm break-words [&_code]:rounded [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_ul]:list-disc"
      data-testid="bridge-result-text"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidBlock } from "./MermaidBlock";

// Rendered view for .md files: GFM (tables, task lists, strikethrough),
// syntax-highlighted fences (themed via the .files-md .hljs-* CSS-variable
// block in FilesPane.css) and ```mermaid fences routed to MermaidBlock.
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="files-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ node: _node, className, children, ...rest }) {
            if (/language-mermaid/.test(className ?? "")) {
              return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

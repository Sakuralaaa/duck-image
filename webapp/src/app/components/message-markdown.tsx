import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

/** Duck.ai 的引用标签不是 HTML；只转换 Markdown 解析出的标签，代码块保持原样。 */
function remarkChatFormatting() {
  return (tree: Root) => {
    function visit(node: MarkdownNode) {
      if (!node.children) return;
      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'html') {
          const html = (child.value ?? '').trim();
          const citation = html.match(/^<citation\s+src\s*=\s*["']([^"']*)["']\s*>(?:\s*<\/citation>)?$/i);
          if (citation) {
            const labels = citation[1].split(',').map((id) => id.trim()).filter(Boolean);
            children.push({ type: 'text', value: labels.map((id) => `[${id}]`).join('') });
            continue;
          }
          if (/^<\/citation\s*>$/i.test(html)) continue;
        }

        if (child.type === 'text' && child.value?.includes('**')) {
          // 有些模型在结束的 ** 前留空格，CommonMark 不会把它识别为加粗。
          const text = child.value;
          const pattern = /\*\*(\S(?:[^\n]*?\S)?)\s+\*\*/g;
          let start = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(text))) {
            if (match.index > start) children.push({ type: 'text', value: text.slice(start, match.index) });
            children.push({ type: 'strong', children: [{ type: 'text', value: match[1] }] });
            start = pattern.lastIndex;
          }
          if (start) {
            if (start < text.length) children.push({ type: 'text', value: text.slice(start) });
            continue;
          }
        }

        visit(child);
        children.push(child);
      }
      node.children = children;
    }
    visit(tree as unknown as MarkdownNode);
  };
}

export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre_code]:break-normal [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-primary [&_a]:underline [&_th]:border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkChatFormatting]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          table: ({ node, ...props }) => (
            <div className="max-w-full overflow-x-auto">
              <table {...props} className="w-full border-collapse text-sm" />
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

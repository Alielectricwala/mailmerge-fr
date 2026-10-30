// Email preview: inbox-style header + body rendered in a sandboxed frame (no scripts)
import { useState } from "react";
import { cn } from "../../lib/cn";
import { FilterChips } from "../ui/Navigation";

const FRAME_STYLE = `<style>
  body{margin:0;padding:20px 24px;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828;background:#fff;word-wrap:break-word}
  p{margin:0 0 1em} a{color:#2168E8} img{max-width:100%;height:auto}
</style><base target="_blank">`;

export function EmailPreview({
  from,
  to,
  replyTo,
  subject,
  html,
  text,
  className,
  height = 420,
}: {
  from?: string;
  to?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  className?: string;
  height?: number;
}) {
  const [view, setView] = useState<"html" | "text">("html");
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}>
      <div className="space-y-1 border-b border-line bg-surface-muted px-4 py-3 text-[13px]">
        {from && (
          <p className="truncate">
            <span className="inline-block w-14 text-ink-subtle">From</span>
            <span className="text-ink">{from}</span>
          </p>
        )}
        {to && (
          <p className="truncate">
            <span className="inline-block w-14 text-ink-subtle">To</span>
            <span className="text-ink">{to}</span>
          </p>
        )}
        {replyTo && (
          <p className="truncate">
            <span className="inline-block w-14 text-ink-subtle">Reply-To</span>
            <span className="text-ink">{replyTo}</span>
          </p>
        )}
        <p className="truncate">
          <span className="inline-block w-14 text-ink-subtle">Subject</span>
          <span className="font-medium text-ink">{subject || <span className="font-normal text-ink-faint">No subject</span>}</span>
        </p>
      </div>
      {text !== undefined && (
        <div className="flex justify-end border-b border-line px-3 py-2">
          <FilterChips
            label="Preview format"
            value={view}
            onChange={setView}
            options={[
              { key: "html", label: "Formatted" },
              { key: "text", label: "Plain text" },
            ]}
          />
        </div>
      )}
      {view === "html" || text === undefined ? (
        <iframe
          title="Email preview"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8">${FRAME_STYLE}</head><body>${html}</body></html>`}
          className="block w-full border-0 bg-white"
          style={{ height }}
        />
      ) : (
        <pre className="overflow-auto whitespace-pre-wrap px-6 py-5 font-sans text-[14px] leading-relaxed text-ink" style={{ height }}>
          {text}
        </pre>
      )}
    </div>
  );
}

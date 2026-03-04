import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { useI18n } from '../i18n/context';

interface ThinkingPanelProps {
  content: string;
  isStreaming: boolean;
}

/**
 * Collapsible panel showing the AI's thinking process (LLM token stream).
 * Terminal-style dark panel with monospace font.
 * @param props - Streaming content and status
 * @returns Collapsible thinking panel
 */
const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ content, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (isExpanded && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [content, isExpanded]);

  if (!content) return null;

  return (
    <div className="mt-4 rounded-lg border border-slate-600/40 bg-slate-800/60 overflow-hidden scanline">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-700/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
          {isStreaming && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-cyan-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {t.thinking.title}
        </span>
        <svg
          className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 max-h-64 overflow-y-auto">
          <div className="prose prose-xs prose-invert max-w-none text-xs leading-relaxed text-emerald-300/70 font-mono">
            <Markdown>{content}</Markdown>
          </div>
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-cyan-400 animate-pulse ml-0.5 align-text-bottom rounded-sm shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;

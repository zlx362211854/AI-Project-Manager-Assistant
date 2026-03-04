import { useState, useRef, useEffect } from 'react';
import type { ProcessResult } from '../types';
import {
  exportMarkdown,
  exportJSON,
  exportCSV,
  exportTimelineSVG,
  exportTimelineHTML,
} from '../utils/export';
import { useI18n } from '../i18n/context';

interface ExportButtonProps {
  result: ProcessResult;
  activeTab: 'table' | 'gantt';
}

type ExportOption = { label: string; action: (r: ProcessResult) => void };

const TABLE_OPTIONS: ExportOption[] = [
  { label: 'Markdown (.md)', action: exportMarkdown },
  { label: 'JSON (.json)', action: exportJSON },
  { label: 'CSV (.csv)', action: exportCSV },
];

const TIMELINE_OPTIONS: ExportOption[] = [
  { label: 'SVG (.svg)', action: exportTimelineSVG },
  { label: 'HTML (.html)', action: exportTimelineHTML },
];

/**
 * Dropdown button for exporting task plan or timeline in multiple formats.
 * Shows different options depending on the active tab.
 * @param props - Contains the ProcessResult and current tab
 * @returns Export button with dropdown menu
 */
const ExportButton: React.FC<ExportButtonProps> = ({ result, activeTab }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const options = activeTab === 'gantt' ? TIMELINE_OPTIONS : TABLE_OPTIONS;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-cyan-500/30 hover:text-cyan-300 transition-all"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        {t.export.export}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-lg border border-slate-600/40 bg-slate-800/95 backdrop-blur-xl py-1 shadow-lg shadow-black/20 z-10">
          {activeTab === 'gantt' && (
            <div className="px-3 py-1.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
              {t.export.timeline}
            </div>
          )}
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => {
                opt.action(result);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800/50 transition-all"
            >
              {opt.label}
            </button>
          ))}
          {activeTab === 'gantt' && (
            <>
              <div className="my-1 border-t border-slate-800" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider">
                {t.export.data}
              </div>
              {TABLE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    opt.action(result);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-slate-400 hover:text-cyan-300 hover:bg-slate-800/50 transition-all"
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ExportButton;

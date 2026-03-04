import { useState, useRef, useCallback } from 'react';
import { useI18n } from '../i18n/context';

interface ExtendFormProps {
  /** Called when the user submits an additional requirement. */
  onSubmit: (newRequirement: string) => void;
  /** Called when the user cancels the extension workflow. */
  onCancel: () => void;
  /** Whether the extension workflow is currently running. */
  isLoading: boolean;
  /** Number of tasks already in the existing plan (for the UI hint). */
  existingTaskCount: number;
  /**
   * The requirement text currently being analysed (shown in the loading state).
   * Should be set by the parent right when onSubmit is called.
   */
  pendingRequirement?: string;
  /** AbortController for cancelling the current request. */
  abortController?: AbortController | null;
}

/**
 * Three-state inline panel shown below a completed task plan:
 *
 *   idle    → "+ 追加新需求" dashed button
 *   open    → textarea form
 *   loading → animated "Analysing…" card (replaces button & form entirely)
 *
 * Only one extension can run at a time; the button is hidden while loading.
 */
const ExtendForm: React.FC<ExtendFormProps> = ({
  onSubmit,
  onCancel,
  isLoading,
  existingTaskCount,
  pendingRequirement = '',
  abortController,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = useCallback(() => {
    setIsOpen(false);
    setValue('');
  }, []);

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
    }
    onCancel();
  }, [abortController, onCancel]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    setIsOpen(false);
    onSubmit(trimmed);
  }, [value, isLoading, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
    if (e.key === 'Escape') {
      resetForm();
    }
  }, [handleSubmit, resetForm]);

  const openForm = useCallback(() => {
    setIsOpen(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);

  // ── Loading state: replace everything with an animated analysis card ─────
  if (isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3.5"
        style={{ boxShadow: '0 0 20px rgba(245,158,11,0.06)' }}
      >
        <div className="flex items-start gap-3">
          {/* Pulsing icon */}
          <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <svg
              className="h-3.5 w-3.5 animate-spin text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-300">
              {t.extend.analyzing}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {t.extend.analyzingDesc}
            </p>
            {pendingRequirement && (
              <p className="mt-2 truncate rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-1.5 text-xs text-slate-300">
                "{pendingRequirement}"
              </p>
            )}
          </div>
        </div>

        {/* Animated progress dots + Cancel button */}
        <div className="mt-3 flex items-center justify-between pl-10">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="h-1 rounded-full bg-amber-500/40"
                style={{
                  width: i % 2 === 0 ? '2rem' : '1rem',
                  animation: `pulse 1.4s ease-in-out ${i * 0.18}s infinite`,
                }}
              />
            ))}
          </div>
          <button
            onClick={handleCancel}
            className="rounded-md px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
          >
            {t.extend.cancel}
          </button>
        </div>
      </div>
    );
  }

  const buttonText = existingTaskCount > 0
    ? t.extend.button.replace('{{count}}', String(existingTaskCount))
    : t.extend.buttonOne;

  return (
    <div className="mt-4">
      {!isOpen ? (
        /* ── Collapsed: single dashed button ─────────────────────────── */
        <button
          id="extend-requirement-btn"
          onClick={openForm}
          className="group flex items-center gap-2 rounded-xl border border-dashed border-slate-600/50 bg-transparent px-4 py-2.5 text-sm text-slate-500 transition-all hover:border-cyan-500/40 hover:bg-cyan-500/5 hover:text-cyan-400"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs transition-transform duration-200 group-hover:rotate-90">
            +
          </span>
          <span>
            {buttonText}
          </span>
        </button>
      ) : (
        /* ── Expanded: textarea form ───────────────────────────────── */
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.extend.placeholder}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
            autoFocus
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              {t.extend.cancel}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.extend.submit}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ExtendForm;

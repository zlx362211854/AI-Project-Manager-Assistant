import { useState, useCallback, useEffect, useRef } from 'react';
import type { ClarificationEvent, ClarificationQuestion } from '../types';
import { useI18n } from '../i18n/context';

interface ClarificationPanelProps {
  event: ClarificationEvent;
  onSubmit: (answers: Record<string, string | string[]>) => void;
  isSubmitting: boolean;
}

const CUSTOM_KEY = '__custom__';

/**
 * Render a single clarification question (choice or text input).
 * Choice questions always include a custom free-text option at the end.
 * @param props - Question data, current answer, and change handler
 * @returns Question UI element
 */
const QuestionField: React.FC<{
  question: ClarificationQuestion;
  value: string | string[];
  onChange: (questionId: string, value: string | string[]) => void;
}> = ({ question, value, onChange }) => {
  const { t } = useI18n();
  const [customText, setCustomText] = useState('');

  if (question.type === 'choice' && question.options) {
    const isMultiple = question.allow_multiple ?? false;
    const selected = isMultiple
      ? (Array.isArray(value) ? value : [])
      : (typeof value === 'string' ? value : '');

    const customSelected = isMultiple
      ? (selected as string[]).some((v) => !question.options!.includes(v))
      : typeof selected === 'string' && selected !== '' && !question.options.includes(selected);

    /** Derive the stored custom text from the current value. */
    const storedCustom = isMultiple
      ? (selected as string[]).find((v) => !question.options!.includes(v)) ?? ''
      : customSelected ? (selected as string) : '';

    const handleChoiceChange = (option: string) => {
      if (isMultiple) {
        const arr = Array.isArray(selected) ? selected : [];
        // Remove any previous custom entry when toggling a predefined option
        const withoutCustom = arr.filter((o) => question.options!.includes(o));
        const next = withoutCustom.includes(option)
          ? withoutCustom.filter((o) => o !== option)
          : [...withoutCustom, option];
        // Re-attach custom entry if it was present
        const custom = arr.find((o) => !question.options!.includes(o));
        onChange(question.id, custom ? [...next, custom] : next);
      } else {
        onChange(question.id, option);
      }
    };

    const handleCustomToggle = () => {
      if (isMultiple) {
        const arr = Array.isArray(selected) ? selected : [];
        const withoutCustom = arr.filter((o) => question.options!.includes(o));
        if (customSelected) {
          // Deselect custom
          setCustomText('');
          onChange(question.id, withoutCustom);
        } else {
          // Select custom — keep existing predefined selections
          onChange(question.id, customText.trim() ? [...withoutCustom, customText.trim()] : withoutCustom);
        }
      } else {
        if (customSelected) {
          setCustomText('');
          onChange(question.id, '');
        } else {
          onChange(question.id, customText.trim() || CUSTOM_KEY);
        }
      }
    };

    const handleCustomTextChange = (text: string) => {
      setCustomText(text);
      if (isMultiple) {
        const arr = Array.isArray(selected) ? selected : [];
        const withoutCustom = arr.filter((o) => question.options!.includes(o));
        onChange(question.id, text.trim() ? [...withoutCustom, text.trim()] : withoutCustom);
      } else {
        onChange(question.id, text.trim() || CUSTOM_KEY);
      }
    };

    return (
      <div className="space-y-2">
        {question.options.map((option) => {
          const isSelected = isMultiple
            ? (selected as string[]).includes(option)
            : selected === option;

          return (
            <label
              key={option}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? 'border-cyan-500/50 bg-cyan-500/12 shadow-[0_0_12px_rgba(6,182,212,0.12)]'
                  : 'border-slate-600/40 hover:border-slate-500/60 hover:bg-slate-700/30'
              }`}
            >
              <input
                type={isMultiple ? 'checkbox' : 'radio'}
                name={question.id}
                value={option}
                checked={isSelected}
                onChange={() => handleChoiceChange(option)}
                className="accent-cyan-500 shrink-0"
              />
              <span className={`text-sm ${isSelected ? 'text-cyan-200 font-medium' : 'text-slate-400'}`}>
                {option}
              </span>
            </label>
          );
        })}

        {/* Custom option */}
        <div
          className={`rounded-lg border transition-all ${
            customSelected
              ? 'border-violet-500/50 bg-violet-500/8 shadow-[0_0_12px_rgba(139,92,246,0.1)]'
              : 'border-slate-600/40 hover:border-slate-500/60'
          }`}
        >
          <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
            <input
              type={isMultiple ? 'checkbox' : 'radio'}
              name={question.id}
              checked={customSelected}
              onChange={handleCustomToggle}
              className="accent-violet-500 shrink-0"
            />
            <span className={`text-sm ${customSelected ? 'text-violet-300 font-medium' : 'text-slate-500'}`}>
              {t.clarification.customOption}
            </span>
          </label>
          {customSelected && (
            <div className="px-3 pb-2.5">
              <input
                autoFocus
                type="text"
                value={storedCustom === CUSTOM_KEY ? customText : (storedCustom || customText)}
                onChange={(e) => handleCustomTextChange(e.target.value)}
                placeholder={t.clarification.customPlaceholder}
                className="w-full rounded-md border border-violet-500/30 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-500/20 focus:outline-none transition-all"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <textarea
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(question.id, e.target.value)}
      placeholder={t.clarification.placeholder}
      rows={2}
      className="w-full rounded-lg border border-slate-500/40 bg-slate-700/40 px-3 py-2.5 text-sm text-slate-300 placeholder-slate-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/15 focus:outline-none resize-none transition-all font-mono"
    />
  );
};

/**
 * Interactive clarification panel that renders AI-generated questions.
 * Supports choice (single/multi-select) and text input questions.
 * Pauses the workflow until the user submits answers.
 * @param props - Clarification event data, submit handler, and loading state
 * @returns Clarification panel UI
 */
const ClarificationPanel: React.FC<ClarificationPanelProps> = ({
  event,
  onSubmit,
  isSubmitting,
}) => {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    setAnswers({});
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [event]);

  const handleChange = useCallback((questionId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(answers);
  }, [answers, onSubmit]);

  const handleSkip = useCallback(() => {
    onSubmit({});
  }, [onSubmit]);

  const answeredCount = event.questions.filter((q) => {
    const a = answers[q.id];
    if (!a) return false;
    if (Array.isArray(a)) return a.length > 0;
    return a.trim().length > 0;
  }).length;

  return (
    <div
      ref={panelRef}
      className="rounded-xl border border-cyan-500/20 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(6,182,212,0.05), rgba(15,23,42,0.9))',
        boxShadow: '0 0 30px rgba(6,182,212,0.08)',
        animation: 'slideUp 0.3s ease',
      }}
    >
      <div className="px-5 py-4 border-b border-cyan-500/10" style={{ background: 'rgba(6,182,212,0.03)' }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.2))',
              boxShadow: '0 0 12px rgba(6,182,212,0.2)',
            }}
          >
            <svg className="h-4 w-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{t.clarification.title}</h3>
            <p className="text-xs text-slate-500">{event.context}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {event.questions.map((question, idx) => (
          <div key={question.id}>
            <div className="flex items-start gap-2 mb-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-cyan-300 shrink-0 mt-0.5"
                style={{
                  background: 'rgba(6,182,212,0.15)',
                  border: '1px solid rgba(6,182,212,0.25)',
                }}
              >
                {idx + 1}
              </span>
              <p className="text-sm font-medium text-slate-300">{question.text}</p>
            </div>
            <div className="ml-7">
              <QuestionField
                question={question}
                value={answers[question.id] ?? (question.type === 'choice' && question.allow_multiple ? [] : '')}
                onChange={handleChange}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-cyan-500/10 flex items-center justify-between" style={{ background: 'rgba(6,182,212,0.03)' }}>
        <span className="text-xs text-slate-600 font-mono">
          {answeredCount}/{event.questions.length} {t.clarification.answered}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800/50 transition-all disabled:opacity-50"
          >
            {t.clarification.skip}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="neon-btn px-5 py-2 text-xs font-medium text-white rounded-lg flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t.clarification.submitting}
              </>
            ) : (
              t.clarification.continue
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClarificationPanel;

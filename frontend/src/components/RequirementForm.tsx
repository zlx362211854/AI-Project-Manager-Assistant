import { useState } from 'react';
import { useI18n } from '../i18n/context';

interface RequirementFormProps {
  onSubmit: (requirement: string, collectTechnical: boolean) => void;
  isLoading: boolean;
}

/**
 * Form component for inputting natural language requirements.
 * Includes example prompts, a textarea for custom input, and a toggle
 * to optionally collect technical implementation details during clarification.
 * @param props - Component props with submit handler and loading state
 * @returns Requirement input form
 */
const RequirementForm: React.FC<RequirementFormProps> = ({ onSubmit, isLoading }) => {
  const [requirement, setRequirement] = useState('');
  const [collectTechnical, setCollectTechnical] = useState(false);
  const { t } = useI18n();

  const examples = [t.form.example1, t.form.example2, t.form.example3];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (requirement.trim() && !isLoading) {
      onSubmit(requirement.trim(), collectTechnical);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="requirement"
          className="block text-sm font-medium text-slate-300 mb-2"
        >
          {t.form.label}
        </label>
        <div className="relative group">
          <textarea
            id="requirement"
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder={t.form.placeholder}
            rows={5}
            className="w-full rounded-lg border border-slate-500/40 bg-slate-800/40 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/15 focus:outline-none transition-all resize-y font-mono"
            disabled={isLoading}
          />
          <div className="absolute inset-0 rounded-lg pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity"
            style={{ boxShadow: '0 0 20px rgba(6, 182, 212, 0.08)' }}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="submit"
            disabled={!requirement.trim() || isLoading}
            className="neon-btn inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-medium text-white"
          >
            {isLoading ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t.form.processing}
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {t.form.submit}
              </>
            )}
          </button>

          {/* Clarification mode dropdown */}
          <div className="relative inline-flex items-center">
            <svg
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <select
              value={collectTechnical ? 'technical' : 'business'}
              onChange={(e) => setCollectTechnical(e.target.value === 'technical')}
              disabled={isLoading}
              className={`appearance-none rounded-lg border pl-8 pr-7 py-2 text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-1 disabled:opacity-40 cursor-pointer ${
                collectTechnical
                  ? 'border-violet-400/50 bg-violet-500/10 text-violet-300 focus:ring-violet-400/30'
                  : 'border-slate-600/40 bg-slate-800/40 text-slate-400 focus:ring-slate-500/30 hover:border-slate-500/60'
              }`}
            >
              <option value="business">{t.form.clarificationModeBusinessOnly}</option>
              <option value="technical">{t.form.clarificationModeWithTechnical}</option>
            </select>
            <svg
              className="pointer-events-none absolute right-2 h-3 w-3 text-slate-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {requirement.trim() && !isLoading && (
          <button
            type="button"
            onClick={() => setRequirement('')}
            className="text-sm text-slate-500 hover:text-cyan-400 transition-colors"
          >
            {t.form.clear}
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">{t.form.examples}</p>
        <div className="flex flex-wrap gap-2">
          {examples.map((example, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setRequirement(example)}
              disabled={isLoading}
              className="rounded-md border border-slate-600/40 bg-slate-700/30 px-3 py-1.5 text-xs text-slate-400 hover:border-cyan-400/40 hover:text-cyan-300 hover:bg-slate-700/50 transition-all disabled:opacity-40 text-left"
            >
              {example.length > 80 ? example.slice(0, 80) + '...' : example}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
};

export default RequirementForm;

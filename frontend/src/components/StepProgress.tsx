import type { WorkflowStep } from '../types';
import { useI18n } from '../i18n/context';

interface StepProgressProps {
  completedSteps: WorkflowStep[];
  currentStep: WorkflowStep | null;
}

const STEP_KEYS: { key: WorkflowStep; tKey: keyof typeof import('../i18n/translations').translations.en.steps; icon: string }[] = [
  { key: 'parse', tKey: 'parse', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'decompose', tKey: 'decompose', icon: 'M4 6h16M4 12h16M4 18h7' },
  { key: 'prioritize', tKey: 'prioritize', icon: 'M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12' },
  { key: 'allocate', tKey: 'allocate', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { key: 'output', tKey: 'output', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
];

/**
 * Visual step-by-step progress indicator for the LangGraph workflow.
 * @param props - Completed steps and currently active step
 * @returns Step progress component
 */
const StepProgress: React.FC<StepProgressProps> = ({ completedSteps, currentStep }) => {
  const { t } = useI18n();

  return (
    <div className="mt-8 mb-2">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center">
          {STEP_KEYS.map((step, index) => {
            const isCompleted = completedSteps.includes(step.key);
            const isActive = currentStep === step.key;
            const nextCompleted = index < STEP_KEYS.length - 1 && completedSteps.includes(STEP_KEYS[index + 1].key);

            return (
              <div key={step.key} className="flex items-center" style={{ flex: index < STEP_KEYS.length - 1 ? 1 : 'none' }}>
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                  {/* Outer ping ring for active state */}
                  {isActive && (
                    <span className="absolute inset-0 rounded-full animate-ping bg-cyan-400/20" />
                  )}

                  {/* Node circle */}
                  <div
                    className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-500 ${
                      isCompleted
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-400'
                        : isActive
                          ? 'border-transparent bg-cyan-500/10 text-cyan-400'
                          : 'border-slate-700 bg-slate-800/50 text-slate-600'
                    }`}
                    style={
                      isCompleted
                        ? { boxShadow: '0 0 12px rgba(52, 211, 153, 0.25)' }
                        : {}
                    }
                  >
                    {isCompleted ? (
                      /* Checkmark */
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      /* Spinning arc overlay + step icon */
                      <>
                        <svg
                          className="animate-spin"
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                          viewBox="0 0 40 40"
                          fill="none"
                        >
                          <circle cx="20" cy="20" r="18" stroke="rgba(6,182,212,0.15)" strokeWidth="2.5" />
                          <path
                            d="M20 2 A18 18 0 0 1 38 20"
                            stroke="rgba(6,182,212,0.9)"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                        </svg>
                        <svg className="h-4 w-4 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={step.icon} />
                        </svg>
                      </>
                    ) : (
                      /* Idle icon */
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={step.icon} />
                      </svg>
                    )}
                  </div>
                </div>

                {index < STEP_KEYS.length - 1 && (
                  <div className="flex-1 mx-2 relative">
                    <div className={`h-px w-full transition-colors duration-500 ${
                      isCompleted && nextCompleted
                        ? 'bg-emerald-400/40'
                        : isCompleted
                          ? 'bg-emerald-400/40'
                          : 'bg-slate-700'
                    }`} />
                    {isCompleted && !nextCompleted && isActive !== true && (
                      <div className="absolute top-0 left-0 h-px bg-linear-to-r from-emerald-400/40 to-transparent w-1/2" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-start mt-2">
          {STEP_KEYS.map((step, index) => {
            const isCompleted = completedSteps.includes(step.key);
            const isActive = currentStep === step.key;

            return (
              <div key={step.key} className="flex items-center" style={{ flex: index < STEP_KEYS.length - 1 ? 1 : 'none' }}>
                <span
                  className={`block w-10 text-center text-[10px] font-medium tracking-wide uppercase transition-colors whitespace-nowrap ${
                    isCompleted
                      ? 'text-emerald-400/80'
                      : isActive
                        ? 'text-cyan-400 glow-text'
                        : 'text-slate-600'
                  }`}
                >
                  {t.steps[step.tKey]}
                </span>
                {index < STEP_KEYS.length - 1 && <div className="flex-1 mx-2" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StepProgress;

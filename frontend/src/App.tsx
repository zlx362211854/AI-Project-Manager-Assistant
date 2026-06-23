import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import RequirementForm from './components/RequirementForm';
import TaskTable from './components/TaskTable';
import GanttChart from './components/GanttChart';
import SummaryPanel from './components/SummaryPanel';
import StepProgress from './components/StepProgress';
import ThinkingPanel from './components/ThinkingPanel';
import ExportButton from './components/ExportButton';
import ClarificationPanel from './components/ClarificationPanel';
import { processRequirementStream, resumeStream, submitClarification, healthCheck, extendRequirementStream } from './services/api';
import { useI18n } from './i18n/context';
import { saveSession, loadSession, clearSession, formatSavedAt } from './utils/persistence';
import type { ProcessResult, WorkflowStep, SubTask, ClarificationEvent, PersistedSession } from './types';
import ExtendForm from './components/ExtendForm';

type ViewTab = 'table' | 'gantt';

/**
 * Root application component for the AI Project Manager.
 * Uses SSE streaming with progressive table rendering and
 * interactive clarification feedback collection.
 * @returns The main application
 */
const App: React.FC = () => {
  const { locale, t } = useI18n();
  const [apiConnected, setApiConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamingTasks, setStreamingTasks] = useState<SubTask[]>([]);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('table');

  const [completedSteps, setCompletedSteps] = useState<WorkflowStep[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clarification, setClarification] = useState<ClarificationEvent | null>(null);
  const [isSubmittingClarification, setIsSubmittingClarification] = useState(false);
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);

  // Persisted session: non-null when we restored data from localStorage on mount
  const [restoredSession, setRestoredSession] = useState<PersistedSession | null>(null);
  // True while the extend (incremental) workflow is running
  const [isExtending, setIsExtending] = useState(false);
  // Number of newly added tasks from the latest extend run
  const [newTaskCount, setNewTaskCount] = useState<number | null>(null);
  // The requirement text currently being analysed during extension
  const [pendingRequirement, setPendingRequirement] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');
  const lastRequirementRef = useRef<string>('');
  const collectTechnicalRef = useRef<boolean>(false);
  // Tracks the active backend session id for resume on reconnect
  const activeSessionIdRef = useRef<string>('');
  // Auto-reconnect: counts consecutive network errors to limit retries
  const autoReconnectCountRef = useRef<number>(0);
  const autoReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Restore persisted session on first mount ──────────────────────────────
  useEffect(() => {
    const session = loadSession();
    if (session) {
      setRestoredSession(session);
      setResult(session.result);
      setCompletedSteps(session.completedSteps);
      setStreamContent(session.streamContent);
      contentRef.current = session.streamContent;
      lastRequirementRef.current = session.requirement;
    }
  }, []);

  useEffect(() => {
    const check = async () => {
      const ok = await healthCheck();
      setApiConnected(ok);
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-save whenever a completed result is available ────────────────────
  useEffect(() => {
    if (result && lastRequirementRef.current) {
      saveSession(
        lastRequirementRef.current,
        result,
        completedSteps,
        contentRef.current,
      );
      // If we just saved a fresh result, dismiss the "restored" banner
      setRestoredSession(null);
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClarificationSubmit = useCallback(async (answers: Record<string, string | string[]>) => {
    if (!sessionId) return;

    setIsSubmittingClarification(true);
    try {
      await submitClarification(sessionId, answers);
      setClarification(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit clarification');
    } finally {
      setIsSubmittingClarification(false);
    }
  }, [sessionId]);

  const NEXT_STEP: Record<string, WorkflowStep | null> = {
    parse: 'decompose',
    decompose: 'prioritize',
    prioritize: 'allocate',
    allocate: 'output',
    adjust: 'allocate',
    output: null,
  };

  /** Build the shared SSE callback object. Used by both startStream and resumeSession. */
  const buildCallbacks = useCallback(() => ({
    onSession: (sid: string) => {
      activeSessionIdRef.current = sid;
      setSessionId(sid);
    },
    onText: (content: string) => {
      contentRef.current += content;
      setStreamContent(contentRef.current);
    },
    onStep: (event: { step: WorkflowStep; label: string }) => {
      setCompletedSteps((prev) => {
        if (prev.includes(event.step)) return prev;
        return [...prev, event.step];
      });
      const next = NEXT_STEP[event.step];
      setCurrentStep(next ?? null);
    },
    onTasksUpdate: (tasks: SubTask[]) => {
      setStreamingTasks(tasks);
    },
    onTaskProcessing: (taskId: string) => {
      setProcessingTaskId(taskId || null);
    },
    onClarification: (event: ClarificationEvent) => {
      setClarification(event);
    },
    onResult: (response: { output: string }) => {
      try {
        const parsed: ProcessResult = JSON.parse(response.output);
        setResult(parsed);
      } catch {
        setError(t.error.parseFailed);
      }
    },
    onError: (message: string) => {
      if (message === '__SESSION_EXPIRED__') {
        // Session gone — fall back to full restart
        setError(t.error.sessionExpired);
        setIsStreaming(false);
        setCurrentStep(null);
        setProcessingTaskId(null);
        autoReconnectCountRef.current = 0;
        return;
      }
      if (message === '__NETWORK_ERROR__') {
        const attempt = autoReconnectCountRef.current;
        const MAX_AUTO = 5;
        if (attempt < MAX_AUTO && activeSessionIdRef.current) {
          // Auto-reconnect with exponential back-off (1s, 2s, 4s, 8s, 16s)
          const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
          autoReconnectCountRef.current += 1;
          setError(`${t.error.networkError} ${t.error.retrying} (${attempt + 1}/${MAX_AUTO})...`);
          autoReconnectTimerRef.current = setTimeout(() => {
            resumeSession();
          }, delay);
        } else {
          setError(t.error.networkError);
          setIsStreaming(false);
          setCurrentStep(null);
          setProcessingTaskId(null);
        }
        return;
      }
      setError(message);
      setIsStreaming(false);
      setCurrentStep(null);
      setProcessingTaskId(null);
    },
    onDone: () => {
      autoReconnectCountRef.current = 0;
      setIsStreaming(false);
      setCurrentStep(null);
      setClarification(null);
      setProcessingTaskId(null);
      abortRef.current = null;
    },
  }), [t]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Reconnect to the existing backend session and replay history. */
  const resumeSession = useCallback(() => {
    if (!activeSessionIdRef.current) return;
    if (abortRef.current) abortRef.current.abort();
    setError(null);
    setIsStreaming(true);
    abortRef.current = resumeStream(activeSessionIdRef.current, buildCallbacks());
  }, [buildCallbacks]);

  const startStream = useCallback((requirement: string, collectTechnical?: boolean) => {
    if (abortRef.current) abortRef.current.abort();
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    autoReconnectCountRef.current = 0;
    activeSessionIdRef.current = '';

    setIsStreaming(true);
    setError(null);
    setSessionId(null);
    setClarification(null);

    const useTechnical = collectTechnical ?? collectTechnicalRef.current;
    abortRef.current = processRequirementStream(requirement, 'json', locale, buildCallbacks(), useTechnical);
  }, [locale, buildCallbacks]);

  const handleSubmit = useCallback((requirement: string, collectTechnical: boolean) => {
    lastRequirementRef.current = requirement;
    collectTechnicalRef.current = collectTechnical;
    setResult(null);
    setStreamContent('');
    setStreamingTasks([]);
    setRestoredSession(null);
    contentRef.current = '';
    setCompletedSteps([]);
    setCurrentStep('parse');
    startStream(requirement, collectTechnical);
  }, [startStream]);

  const handleClearSession = useCallback(() => {
    clearSession();
    setRestoredSession(null);
    setResult(null);
    setStreamContent('');
    setStreamingTasks([]);
    setCompletedSteps([]);
    setCurrentStep(null);
    setNewTaskCount(null);
    contentRef.current = '';
    lastRequirementRef.current = '';
  }, []);

  /** Run the incremental extend workflow against the current result. */
  const handleExtend = useCallback((newRequirement: string) => {
    if (!result || isExtending) return;

    setIsExtending(true);
    setPendingRequirement(newRequirement);
    setNewTaskCount(null);
    setError(null);
    setStreamContent('');
    contentRef.current = '';
    setStreamingTasks(result.subtasks);

    const callbacks = {
      onSession: () => {},
      onText: (content: string) => {
        contentRef.current += content;
        setStreamContent(contentRef.current);
      },
      onStep: () => {},
      onTasksUpdate: (tasks: SubTask[]) => {
        setStreamingTasks(tasks);
      },
      onTaskProcessing: () => {},
      onClarification: () => {},
      onResult: (response: { output: string }) => {
        try {
          const parsed: ProcessResult & { new_task_count?: number } = JSON.parse(response.output);
          setResult(parsed);
          setStreamingTasks([]);
          if (parsed.new_task_count != null) {
            setNewTaskCount(parsed.new_task_count);
          }
        } catch {
          setError(t.error.parseFailed);
        }
      },
      onError: (message: string) => {
        setError(message);
        setIsExtending(false);
        setPendingRequirement('');
        setStreamingTasks([]);
      },
      onDone: () => {
        setIsExtending(false);
        setPendingRequirement('');
        setStreamingTasks([]);
        setStreamContent('');
        contentRef.current = '';
      },
    };

    const controller = extendRequirementStream(newRequirement, result, locale, callbacks);
    abortRef.current = controller;
  }, [result, isExtending, locale, t]);

  const handleExtendCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsExtending(false);
    setPendingRequirement('');
    setStreamingTasks([]);
    setStreamContent('');
    contentRef.current = '';
  }, []);

  /** Manual retry: resume same session if available, otherwise restart from scratch. */
  const handleRetry = useCallback(() => {
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    if (activeSessionIdRef.current) {
      autoReconnectCountRef.current = 0;
      resumeSession();
    } else if (lastRequirementRef.current) {
      setResult(null);
      setStreamContent('');
      setStreamingTasks([]);
      contentRef.current = '';
      setCompletedSteps([]);
      setCurrentStep('parse');
      startStream(lastRequirementRef.current);
    }
  }, [resumeSession, startStream]);

  const displayTasks = result ? result.subtasks : streamingTasks;
  const hasTasks = displayTasks.length > 0;

  return (
    <div className="min-h-screen bg-surface-secondary grid-bg">
      <Header apiConnected={apiConnected} />

      <main className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* ── Restored session banner ───────────────────────────────────── */}
        {restoredSession && !isStreaming && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3"
            style={{ boxShadow: '0 0 20px rgba(6,182,212,0.06)' }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
                <svg className="h-4 w-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-cyan-300">
                  {locale === 'zh' ? '已恢复上次任务计划' : 'Previous plan restored'}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {formatSavedAt(restoredSession.savedAt, locale)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400 truncate max-w-xl">
                  {restoredSession.requirement}
                </p>
              </div>
            </div>
            <button
              onClick={handleClearSession}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-600/40 bg-slate-700/40 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-700/70 hover:text-slate-200 transition-all"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {locale === 'zh' ? '清除' : 'Clear'}
            </button>
          </div>
        )}

        <div className="glass rounded-xl p-4 sm:p-6 glow-border">
          <RequirementForm onSubmit={handleSubmit} isLoading={isStreaming} />
        </div>

        {error && (
          <div className="mt-6 glass rounded-lg p-4 border border-red-500/20"
            style={{ boxShadow: '0 0 20px rgba(239, 68, 68, 0.1)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 shrink-0">
                  <svg className="h-4 w-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-red-300">{t.error.title}</h3>
                  <p className="mt-1 text-sm text-red-400/80">{error}</p>
                </div>
              </div>
              {lastRequirementRef.current && !isStreaming && (
                <button
                  onClick={handleRetry}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 hover:border-red-500/50 transition-all"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {t.error.retry}
                </button>
              )}
            </div>
          </div>
        )}

        {(isStreaming || hasTasks) && (
          <StepProgress completedSteps={completedSteps} currentStep={currentStep} />
        )}

        {(isStreaming || hasTasks) && (
          <div className="mt-6 space-y-4">
            {clarification && (
              <ClarificationPanel
                event={clarification}
                onSubmit={handleClarificationSubmit}
                isSubmitting={isSubmittingClarification}
              />
            )}

            {result && (
              <div className="glass rounded-xl glow-border p-3 sm:p-5">
                <SummaryPanel result={result} />
                {newTaskCount != null && newTaskCount > 0 && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {locale === 'zh' ? `已追加 ${newTaskCount} 个新任务` : `${newTaskCount} new task${newTaskCount !== 1 ? 's' : ''} added`}
                  </div>
                )}
              </div>
            )}

            <div className="glass rounded-xl glow-border overflow-hidden">
              {!isStreaming && result && (
                <div className="border-b border-slate-700/50 px-3 sm:px-4 flex items-center justify-between gap-2">
                  <nav className="flex gap-4 sm:gap-6">
                    {([
                      { key: 'table', label: 'Task List' },
                      { key: 'gantt', label: 'Timeline' },
                    ] as const).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`py-3 text-sm font-medium border-b-2 transition-all ${
                          activeTab === tab.key
                            ? 'border-cyan-400 text-cyan-300'
                            : 'border-transparent text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {tab.key === 'table' ? t.tabs.taskList : t.tabs.timeline}
                      </button>
                    ))}
                  </nav>
                  <ExportButton result={result} activeTab={activeTab} />
                </div>
              )}

              <div className="p-3 sm:p-4">
                {hasTasks && (activeTab === 'table' || isStreaming) && (
                  <TaskTable tasks={displayTasks} isStreaming={isStreaming} processingTaskId={processingTaskId} />
                )}
                {!isStreaming && result && activeTab === 'gantt' && (
                  <GanttChart tasks={result.subtasks} />
                )}
                {!hasTasks && isStreaming && !clarification && (
                  <div className="py-8 text-center text-sm text-slate-500 animate-pulse">
                    <div className="inline-flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
                      </span>
                      {t.empty.analyzing}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Extend with additional requirements ───────────────────── */}
            {!isStreaming && result && (
              <ExtendForm
                onSubmit={handleExtend}
                onCancel={handleExtendCancel}
                isLoading={isExtending}
                existingTaskCount={result.subtasks.length}
                pendingRequirement={pendingRequirement}
                abortController={abortRef.current}
              />
            )}

            <ThinkingPanel content={streamContent} isStreaming={isStreaming || isExtending} />
          </div>
        )}

        {!hasTasks && !isStreaming && !error && (
          <div className="mt-12 text-center py-16">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl mb-6"
              style={{
                background: 'linear-gradient(135deg, rgba(6,182,212,0.1), rgba(59,130,246,0.1))',
                boxShadow: '0 0 40px rgba(6,182,212,0.1)',
                border: '1px solid rgba(6,182,212,0.15)',
              }}
            >
              <svg className="h-9 w-9 text-cyan-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-200">
              {t.empty.title}
            </h3>
            <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
              {t.empty.description}
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

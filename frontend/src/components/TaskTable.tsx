import { useState, useEffect, useRef } from 'react';
import type { SubTask, Priority } from '../types';
import { useI18n } from '../i18n/context';

interface TaskTableProps {
  tasks: SubTask[];
  isStreaming?: boolean;
  processingTaskId?: string | null;
}

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; glow: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400', glow: 'shadow-[0_0_8px_rgba(239,68,68,0.2)]' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', glow: 'shadow-[0_0_8px_rgba(249,115,22,0.2)]' },
  medium: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', glow: 'shadow-[0_0_8px_rgba(6,182,212,0.2)]' },
  low: { bg: 'bg-slate-500/15', text: 'text-slate-400', glow: '' },
};

/**
 * Skeleton placeholder for cells not yet populated.
 * @returns Animated skeleton bar
 */
const Skeleton: React.FC<{ width?: string }> = ({ width = 'w-16' }) => (
  <span className={`inline-block ${width} h-4 rounded bg-slate-700/50 animate-pulse`} />
);

/**
 * @param tasks - Current task list
 * @returns Whether priorities have been explicitly assigned
 */
function hasPrioritiesAssigned(tasks: SubTask[]): boolean {
  if (tasks.length <= 1) return tasks.some((t) => t.priority !== 'medium');
  const priorities = new Set(tasks.map((t) => t.priority));
  return priorities.size > 1;
}

/**
 * @param tasks - Current task list
 * @returns Whether allocation has occurred
 */
function hasAllocation(tasks: SubTask[]): boolean {
  return tasks.some((t) => t.assignee !== null);
}

/**
 * Render a labeled detail section inside the expanded area.
 * @param label - Section label
 * @param icon - SVG path data for the icon
 * @param children - Section content
 */
const DetailSection: React.FC<{
  label: string;
  icon: string;
  children: React.ReactNode;
}> = ({ label, icon, children }) => (
  <div className="flex gap-2">
    <svg className="h-3.5 w-3.5 text-cyan-500/40 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
    </svg>
    <div className="min-w-0">
      <div className="text-[10px] font-medium text-cyan-400/50 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-xs text-slate-400 leading-relaxed">{children}</div>
    </div>
  </div>
);

/**
 * Progressive task table with expandable row details.
 * Columns fill in progressively during streaming.
 * Click a row to expand full task details (user story, acceptance criteria, technical notes).
 * @param props - Tasks array and streaming status
 * @returns Task table component
 */
/**
 * Compute a lightweight content fingerprint for a task to detect field updates.
 * @param task - SubTask to fingerprint
 * @returns String fingerprint of mutable content fields
 */
function taskFingerprint(task: SubTask): string {
  return [
    task.description,
    task.user_story,
    task.technical_notes,
    task.estimated_time,
    (task.acceptance_criteria ?? []).join('|'),
  ].join('§');
}

const TaskTable: React.FC<TaskTableProps> = ({ tasks, isStreaming = false, processingTaskId = null }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const prevFingerprintsRef = useRef<Map<string, string>>(new Map());
  const { t } = useI18n();

  // Detect which tasks had their content updated and trigger a flash highlight.
  useEffect(() => {
    const prev = prevFingerprintsRef.current;
    const updated: string[] = [];

    for (const task of tasks) {
      const fp = taskFingerprint(task);
      const prevFp = prev.get(task.id);
      // Only flash if the task already existed before (prevFp defined) and changed.
      if (prevFp !== undefined && prevFp !== fp) {
        updated.push(task.id);
      }
      prev.set(task.id, fp);
    }

    if (updated.length === 0) return;

    setFlashIds((prev) => {
      const next = new Set(prev);
      updated.forEach((id) => next.add(id));
      return next;
    });

    const timer = setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        updated.forEach((id) => next.delete(id));
        return next;
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [tasks]);

  if (tasks.length === 0) return null;

  const prioritiesReady = hasPrioritiesAssigned(tasks);
  const allocationReady = hasAllocation(tasks);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-600/40">
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">#</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{t.table.task}</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              {t.table.priority}
              {!prioritiesReady && isStreaming && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
              )}
            </th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{t.table.hours}</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              {t.table.role}
              {!allocationReady && isStreaming && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
              )}
            </th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              {t.table.schedule}
              {!allocationReady && isStreaming && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
              )}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/40">
          {tasks.map((task, index) => {
            const isExpanded = expandedIds.has(task.id);
            const hasDetails = task.description || task.user_story || task.acceptance_criteria?.length > 0 || task.technical_notes;
            const pStyle = PRIORITY_STYLES[task.priority];

            const isFlashing = flashIds.has(task.id);
            const isProcessing = processingTaskId === task.id;

            return (
              <tr
                key={task.id}
                className={`transition-all duration-300 ${hasDetails ? 'cursor-pointer hover:bg-slate-700/25' : ''} ${isFlashing ? 'task-flash' : ''} ${isProcessing ? 'task-scanning' : ''}`}
                style={{ animation: `fadeIn 0.3s ease ${index * 50}ms both` }}
                onClick={() => hasDetails && toggleExpand(task.id)}
              >
                <td className="px-4 py-3 text-slate-600 font-mono text-xs align-top">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-1.5">
                    {isProcessing && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                      </span>
                    )}
                    {!isProcessing && hasDetails && (
                      <svg
                        className={`h-3.5 w-3.5 text-cyan-500/40 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                    <span className={`font-medium transition-colors duration-300 ${isProcessing ? 'text-cyan-300' : 'text-slate-200'}`}>
                      {task.title}
                    </span>
                  </div>

                  {task.pending_answers && (
                    <div className="mt-2 ml-5 rounded-md border border-cyan-500/30 bg-cyan-950/40 px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-cyan-400/80 uppercase tracking-wider">
                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
                        </span>
                        {t.table.yourAnswers}
                      </div>
                      {Object.values(task.pending_answers).map((ans, i) => (
                        <div key={i} className="text-xs text-slate-300 leading-relaxed pl-3 border-l border-cyan-500/20">
                          {Array.isArray(ans) ? ans.join(', ') : ans}
                        </div>
                      ))}
                      <div className="text-[10px] text-cyan-400/50 italic pt-0.5">{t.table.updatingTask}</div>
                    </div>
                  )}

                  {!isExpanded && !task.pending_answers && task.description && (
                    <div className="text-xs text-slate-500 mt-0.5 ml-5 line-clamp-1 opacity-70">
                      {task.description}
                    </div>
                  )}

                  {isExpanded && hasDetails && (
                    <div className="mt-2.5 ml-5 space-y-3 pb-1 border-l border-cyan-500/20 pl-3">
                      {task.description && (
                        <DetailSection label={t.table.description} icon="M4 6h16M4 12h16M4 18h12">
                          {task.description}
                        </DetailSection>
                      )}

                      {task.user_story && (
                        <DetailSection label={t.table.userStory} icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z">
                          <span className="italic text-slate-400/80">{task.user_story}</span>
                        </DetailSection>
                      )}

                      {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                        <DetailSection label={t.table.acceptanceCriteria} icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z">
                          <ul className="space-y-0.5">
                            {task.acceptance_criteria.map((ac, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className="text-cyan-500/50 mt-0.5 shrink-0">&#x2022;</span>
                                <span>{ac}</span>
                              </li>
                            ))}
                          </ul>
                        </DetailSection>
                      )}

                      {task.technical_notes && (
                        <DetailSection label={t.table.technicalNotes} icon="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4">
                          <span className="font-mono text-[11px] bg-slate-700/60 text-emerald-300/80 px-2 py-1 rounded border border-slate-600/40">
                            {task.technical_notes}
                          </span>
                        </DetailSection>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  {prioritiesReady || !isStreaming ? (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all duration-500 ${pStyle.bg} ${pStyle.text} ${pStyle.glow}`}>
                      {task.priority}
                    </span>
                  ) : (
                    <Skeleton width="w-14" />
                  )}
                </td>
                <td className="px-4 py-3 text-cyan-300/70 font-mono text-xs align-top">
                  {Math.round(task.estimated_time)}h
                </td>
                <td className="px-4 py-3 align-top">
                  {allocationReady || !isStreaming ? (
                    task.assignee ? (
                      <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-medium text-violet-300 shadow-[0_0_8px_rgba(139,92,246,0.15)]">
                        {task.assignee.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <span className="text-slate-600">{t.table.unassigned}</span>
                    )
                  ) : (
                    <Skeleton width="w-20" />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 font-mono align-top">
                  {allocationReady || !isStreaming ? (
                    task.start_date && task.end_date
                      ? `${task.start_date} ~ ${task.end_date}`
                      : t.table.tbd
                  ) : (
                    <Skeleton width="w-28" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TaskTable;

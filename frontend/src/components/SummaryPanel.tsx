import type { ProcessResult, Priority } from '../types';
import { useI18n } from '../i18n/context';

interface SummaryPanelProps {
  result: ProcessResult;
}

const STAT_STYLES = [
  { gradient: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-500/20', text: 'text-cyan-300', glow: '0 0 15px rgba(6,182,212,0.15)' },
  { gradient: 'from-emerald-500/20 to-teal-500/20', border: 'border-emerald-500/20', text: 'text-emerald-300', glow: '0 0 15px rgba(16,185,129,0.15)' },
  { gradient: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-500/20', text: 'text-violet-300', glow: '0 0 15px rgba(139,92,246,0.15)' },
  { gradient: 'from-orange-500/20 to-amber-500/20', border: 'border-orange-500/20', text: 'text-orange-300', glow: '0 0 15px rgba(249,115,22,0.15)' },
];

/**
 * Horizontal summary panel showing key metrics from the processed result.
 * @param props - Component props with the processed result
 * @returns Summary metrics panel
 */
const SummaryPanel: React.FC<SummaryPanelProps> = ({ result }) => {
  const { requirement, subtasks, total_estimated_hours, adjustment_iterations } = result;
  const { t } = useI18n();

  const priorityCounts = subtasks.reduce(
    (acc, task) => {
      acc[task.priority] = (acc[task.priority] || 0) + 1;
      return acc;
    },
    {} as Record<Priority, number>,
  );

  const roles = new Set(subtasks.map((t) => t.assignee).filter(Boolean));

  const stats = [
    { label: t.summary.totalTasks, value: subtasks.length },
    { label: t.summary.totalHours, value: `${Math.round(total_estimated_hours)}h` },
    { label: t.summary.roles, value: roles.size },
    { label: t.summary.adjustments, value: adjustment_iterations },
  ];

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-400',
    high: 'bg-orange-400',
    medium: 'bg-cyan-400',
    low: 'bg-slate-500',
  };

  const priorityLabels: Record<string, string> = {
    critical: t.summary.critical,
    high: t.summary.high,
    medium: t.summary.medium,
    low: t.summary.low,
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <div className="shrink-0 md:max-w-xs">
        <h3 className="text-sm font-semibold text-slate-200 mb-1">
          {requirement.title}
        </h3>
        <span className="inline-flex items-center rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-300 uppercase tracking-wide">
          {requirement.type.replace('_', ' ')}
        </span>
        <p className="mt-2 text-xs text-slate-500 leading-relaxed line-clamp-2">
          {requirement.description}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
        {stats.map((stat, i) => {
          const style = STAT_STYLES[i];
          return (
            <div
              key={stat.label}
              className={`rounded-lg bg-linear-to-br ${style.gradient} border ${style.border} px-3 sm:px-5 py-2.5 sm:py-3 text-center sm:min-w-[90px]`}
              style={{ boxShadow: style.glow }}
            >
              <div className={`text-base sm:text-lg font-bold font-mono ${style.text}`}>{stat.value}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 md:min-w-[200px]">
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t.summary.priorityBreakdown}</h4>
        <div className="space-y-1.5">
          {(['critical', 'high', 'medium', 'low'] as Priority[]).map((level) => {
            const count = priorityCounts[level] || 0;
            const pct = subtasks.length > 0 ? (count / subtasks.length) * 100 : 0;
            return (
              <div key={level} className="flex items-center gap-2 text-xs">
                <span className="w-14 text-slate-500 capitalize">{priorityLabels[level]}</span>
                <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${priorityColors[level]}`}
                    style={{ width: `${pct}%`, boxShadow: pct > 0 ? '0 0 8px currentColor' : 'none' }}
                  />
                </div>
                <span className="w-6 text-right text-slate-600 font-mono">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SummaryPanel;

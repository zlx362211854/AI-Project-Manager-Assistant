import { useMemo } from 'react';
import type { SubTask, Priority } from '../types';
import { useI18n } from '../i18n/context';

interface GanttChartProps {
  tasks: SubTask[];
}

const PRIORITY_COLORS: Record<Priority, { bg: string; glow: string }> = {
  critical: { bg: 'bg-red-500/70', glow: '0 0 10px rgba(239,68,68,0.3)' },
  high: { bg: 'bg-orange-500/70', glow: '0 0 10px rgba(249,115,22,0.3)' },
  medium: { bg: 'bg-cyan-500/70', glow: '0 0 10px rgba(6,182,212,0.3)' },
  low: { bg: 'bg-slate-500/50', glow: 'none' },
};

/**
 * Simple horizontal Gantt-style timeline chart for scheduled tasks.
 * @param props - Component props with tasks array
 * @returns Gantt chart component
 */
const GanttChart: React.FC<GanttChartProps> = ({ tasks }) => {
  const { t } = useI18n();
  const scheduledTasks = tasks.filter((t) => t.start_date && t.end_date);

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (scheduledTasks.length === 0) {
      return { minDate: new Date(), maxDate: new Date(), totalDays: 1 };
    }

    const starts = scheduledTasks.map((t) => new Date(t.start_date!).getTime());
    const ends = scheduledTasks.map((t) => new Date(t.end_date!).getTime());
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    const days = Math.max(1, Math.ceil((max.getTime() - min.getTime()) / 86400000) + 1);

    return { minDate: min, maxDate: max, totalDays: days };
  }, [scheduledTasks]);

  if (scheduledTasks.length === 0) {
    return (
      <div className="text-center py-8 text-slate-600 text-sm">
        {t.gantt.noTasks}
      </div>
    );
  }

  const getBarStyle = (startDate: string, endDate: string) => {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const range = totalDays * 86400000;
    const left = ((start - minDate.getTime()) / range) * 100;
    const width = Math.max(3, ((end - start) / range) * 100);
    return { left: `${left}%`, width: `${width}%` };
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 uppercase tracking-wider px-1 mb-3">
        <span>{minDate.toLocaleDateString()}</span>
        <span>{maxDate.toLocaleDateString()}</span>
      </div>
      {scheduledTasks.map((task) => {
        const style = getBarStyle(task.start_date!, task.end_date!);
        const pColor = PRIORITY_COLORS[task.priority];
        return (
          <div key={task.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <div className="w-full sm:w-32 sm:shrink-0 text-xs text-slate-400 truncate sm:text-right font-mono">
              {task.title}
            </div>
            <div className="relative w-full sm:flex-1 h-6 sm:h-7 bg-slate-700/40 rounded border border-slate-600/30 overflow-hidden">
              <div
                className={`absolute top-0.5 bottom-0.5 rounded ${pColor.bg} transition-all`}
                style={{ ...style, boxShadow: pColor.glow }}
                title={`${task.title} (${Math.round(task.estimated_time)}h) - ${task.assignee?.replace(/_/g, ' ') || t.table.unassigned}`}
              >
                <span className="absolute inset-0 flex items-center px-2 text-[10px] text-white/90 font-medium truncate">
                  {task.assignee?.replace(/_/g, ' ') || ''}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default GanttChart;

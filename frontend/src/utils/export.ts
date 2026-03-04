import type { ProcessResult, SubTask } from '../types';

/**
 * Trigger a browser file download with the given content.
 * @param content - File content string
 * @param filename - Suggested filename
 * @param mimeType - MIME type for the file
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#60a5fa',
  low: '#d1d5db',
};

/**
 * Export result as a Markdown document.
 * @param result - The processed result to export
 */
export function exportMarkdown(result: ProcessResult): void {
  const { requirement, subtasks, total_estimated_hours, adjustment_iterations } = result;
  const lines: string[] = [];

  lines.push(`# ${requirement.title}\n`);
  lines.push(`**Type:** ${requirement.type.replace('_', ' ')}`);
  lines.push(`**Description:** ${requirement.description}`);
  lines.push(`**Total Estimated Hours:** ${Math.round(total_estimated_hours)}\n`);

  lines.push('## Task Breakdown\n');
  lines.push('| # | Task | Priority | Est. Hours | Role | Start | End |');
  lines.push('|---|------|----------|-----------|------|-------|-----|');
  subtasks.forEach((task, i) => {
    lines.push(
      `| ${i + 1} | ${task.title} | ${task.priority} | ` +
      `${Math.round(task.estimated_time)}h | ${task.assignee || 'Unassigned'} | ` +
      `${task.start_date || 'TBD'} | ${task.end_date || 'TBD'} |`,
    );
  });

  lines.push('\n## Task Details\n');
  subtasks.forEach((task, i) => {
    lines.push(`### ${i + 1}. ${task.title}\n`);
    if (task.description) lines.push(`**Description:** ${task.description}\n`);
    if (task.user_story) lines.push(`**User Story:** ${task.user_story}\n`);
    if (task.acceptance_criteria?.length > 0) {
      lines.push('**Acceptance Criteria:**');
      task.acceptance_criteria.forEach((ac) => lines.push(`- ${ac}`));
      lines.push('');
    }
    if (task.technical_notes) lines.push(`**Technical Notes:** ${task.technical_notes}\n`);
  });

  if (adjustment_iterations > 0) {
    lines.push(`\n> Tasks were adjusted ${adjustment_iterations} time(s) due to resource constraints.`);
  }

  const slug = requirement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadFile(lines.join('\n'), `${slug}-plan.md`, 'text/markdown;charset=utf-8');
}

/**
 * Export result as a JSON document.
 * @param result - The processed result to export
 */
export function exportJSON(result: ProcessResult): void {
  const content = JSON.stringify(result, null, 2);
  const slug = result.requirement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadFile(content, `${slug}-plan.json`, 'application/json;charset=utf-8');
}

/**
 * Export result as a CSV document.
 * @param result - The processed result to export
 */
export function exportCSV(result: ProcessResult): void {
  const headers = [
    '#', 'Task', 'Description', 'User Story', 'Acceptance Criteria',
    'Technical Notes', 'Priority', 'Est. Hours', 'Role', 'Start', 'End',
  ];
  const rows = result.subtasks.map((task, i) => [
    i + 1,
    `"${task.title.replace(/"/g, '""')}"`,
    `"${task.description.replace(/"/g, '""')}"`,
    `"${(task.user_story || '').replace(/"/g, '""')}"`,
    `"${(task.acceptance_criteria || []).join('; ').replace(/"/g, '""')}"`,
    `"${(task.technical_notes || '').replace(/"/g, '""')}"`,
    task.priority,
    Math.round(task.estimated_time),
    task.assignee || 'Unassigned',
    task.start_date || 'TBD',
    task.end_date || 'TBD',
  ]);

  const content = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const slug = result.requirement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadFile(content, `${slug}-plan.csv`, 'text/csv;charset=utf-8');
}

/**
 * Build timeline bar geometry from scheduled tasks.
 * @param tasks - Subtask list with dates
 * @returns Scheduled tasks with computed positions and date range info
 */
function computeTimeline(tasks: SubTask[]) {
  const scheduled = tasks.filter((t) => t.start_date && t.end_date);
  if (scheduled.length === 0) return null;

  const starts = scheduled.map((t) => new Date(t.start_date!).getTime());
  const ends = scheduled.map((t) => new Date(t.end_date!).getTime());
  const minTime = Math.min(...starts);
  const maxTime = Math.max(...ends);
  const range = maxTime - minTime || 86400000;

  return {
    scheduled,
    minDate: new Date(minTime),
    maxDate: new Date(maxTime),
    range,
    getBar: (task: SubTask) => {
      const s = new Date(task.start_date!).getTime();
      const e = new Date(task.end_date!).getTime();
      const left = (s - minTime) / range;
      const width = Math.max(0.03, (e - s) / range);
      return { left, width };
    },
  };
}

/**
 * Export timeline as an SVG file.
 * @param result - The processed result to export
 */
export function exportTimelineSVG(result: ProcessResult): void {
  const tl = computeTimeline(result.subtasks);
  if (!tl) return;

  const labelW = 160;
  const chartW = 600;
  const rowH = 32;
  const padTop = 30;
  const totalW = labelW + chartW + 20;
  const totalH = padTop + tl.scheduled.length * rowH + 10;

  const rows = tl.scheduled.map((task, i) => {
    const bar = tl.getBar(task);
    const x = labelW + bar.left * chartW;
    const w = bar.width * chartW;
    const y = padTop + i * rowH;
    const color = PRIORITY_COLORS[task.priority] || '#60a5fa';
    const role = (task.assignee || '').replace(/_/g, ' ');

    return [
      `<text x="${labelW - 8}" y="${y + 20}" text-anchor="end" font-size="11" fill="#4b5563">${task.title}</text>`,
      `<rect x="${labelW}" y="${y + 4}" width="${chartW}" height="${rowH - 8}" rx="3" fill="#f3f4f6"/>`,
      `<rect x="${x}" y="${y + 6}" width="${w}" height="${rowH - 12}" rx="3" fill="${color}" opacity="0.85"/>`,
      `<text x="${x + 4}" y="${y + 20}" font-size="9" fill="white" font-weight="500">${role}</text>`,
    ].join('\n');
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" style="font-family:system-ui,sans-serif">`,
    `<text x="${labelW}" y="18" font-size="10" fill="#9ca3af">${tl.minDate.toLocaleDateString()}</text>`,
    `<text x="${labelW + chartW}" y="18" text-anchor="end" font-size="10" fill="#9ca3af">${tl.maxDate.toLocaleDateString()}</text>`,
    ...rows,
    '</svg>',
  ].join('\n');

  const slug = result.requirement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadFile(svg, `${slug}-timeline.svg`, 'image/svg+xml;charset=utf-8');
}

/**
 * Export timeline as a standalone HTML file viewable in any browser.
 * @param result - The processed result to export
 */
export function exportTimelineHTML(result: ProcessResult): void {
  const tl = computeTimeline(result.subtasks);
  if (!tl) return;

  const taskRows = tl.scheduled.map((task) => {
    const bar = tl.getBar(task);
    const color = PRIORITY_COLORS[task.priority] || '#60a5fa';
    const role = (task.assignee || '').replace(/_/g, ' ');
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="width:160px;text-align:right;font-size:12px;color:#4b5563;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${task.title}</div>
        <div style="flex:1;height:28px;background:#f3f4f6;border-radius:4px;position:relative;overflow:hidden">
          <div style="position:absolute;top:3px;bottom:3px;left:${bar.left * 100}%;width:${bar.width * 100}%;background:${color};border-radius:3px;opacity:0.85;display:flex;align-items:center;padding:0 6px">
            <span style="font-size:10px;color:white;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${role}</span>
          </div>
        </div>
      </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${result.requirement.title} - Timeline</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1f2937; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .dates { display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; margin-bottom: 12px; padding: 0 172px 0 172px; }
  .legend { display: flex; gap: 16px; margin-top: 20px; font-size: 11px; color: #6b7280; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
</style>
</head>
<body>
  <h1>${result.requirement.title}</h1>
  <div class="meta">${result.subtasks.length} tasks &middot; ${Math.round(result.total_estimated_hours)}h total</div>
  <div class="dates">
    <span>${tl.minDate.toLocaleDateString()}</span>
    <span>${tl.maxDate.toLocaleDateString()}</span>
  </div>
  ${taskRows}
  <div class="legend">
    <span><i style="background:#f87171"></i> Critical</span>
    <span><i style="background:#fb923c"></i> High</span>
    <span><i style="background:#60a5fa"></i> Medium</span>
    <span><i style="background:#d1d5db"></i> Low</span>
  </div>
</body>
</html>`;

  const slug = result.requirement.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  downloadFile(html, `${slug}-timeline.html`, 'text/html;charset=utf-8');
}

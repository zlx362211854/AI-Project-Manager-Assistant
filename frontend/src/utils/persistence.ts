/**
 * Frontend persistence utilities using localStorage.
 *
 * Stores the last completed task plan so users can resume viewing
 * their results after a page refresh without re-running the workflow.
 */

import type { ProcessResult, WorkflowStep } from '../types';

const STORAGE_KEY = 'ai_pm_session';
const STORAGE_VERSION = 1;

export interface PersistedSession {
  version: number;
  savedAt: string;            // ISO timestamp
  requirement: string;        // original user input
  result: ProcessResult;      // final task plan
  completedSteps: WorkflowStep[];
  streamContent: string;      // LLM thinking panel text
}

/**
 * Save the current completed session to localStorage.
 * Only called after a successful workflow run (result is non-null).
 */
export function saveSession(
  requirement: string,
  result: ProcessResult,
  completedSteps: WorkflowStep[],
  streamContent: string,
): void {
  try {
    const session: PersistedSession = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      requirement,
      result,
      completedSteps,
      streamContent,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage may be full or blocked; fail silently
  }
}

/**
 * Load the last persisted session from localStorage.
 * Returns null if no valid session is found.
 */
export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    // Version guard: discard incompatible old data
    if (parsed.version !== STORAGE_VERSION) {
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove the persisted session from localStorage.
 */
export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Format a saved-at timestamp into a human-readable relative string.
 * e.g. "刚刚", "3分钟前", "昨天 14:30"
 */
export function formatSavedAt(isoString: string, locale: string): string {
  const saved = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - saved.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (locale === 'zh') {
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    return saved.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } else {
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return saved.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

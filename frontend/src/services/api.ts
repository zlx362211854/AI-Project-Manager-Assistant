import type { TeamMember, StreamCallbacks } from '../types';

const API_BASE = '/api';

/**
 * Consume an SSE response body and dispatch events to callbacks.
 * Shared by processRequirementStream and resumeStream.
 * @param response - Fetch Response with SSE body
 * @param callbacks - Event handlers
 */
async function _consumeSSE(response: Response, callbacks: StreamCallbacks): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('ReadableStream not supported');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  let eventData = '';

  const processEvent = () => {
    if (!eventType || !eventData) return;
    try {
      const parsed = JSON.parse(eventData);
      switch (eventType) {
        case 'session':
          callbacks.onSession(parsed.session_id || '');
          break;
        case 'text':
          callbacks.onText(parsed.content || '');
          break;
        case 'step':
          callbacks.onStep(parsed);
          break;
        case 'tasks_update':
          callbacks.onTasksUpdate(parsed.tasks || []);
          break;
        case 'task_processing':
          callbacks.onTaskProcessing(parsed.task_id || '');
          break;
        case 'clarification':
          callbacks.onClarification(parsed);
          break;
        case 'result':
          callbacks.onResult(parsed);
          break;
        case 'error':
          callbacks.onError(parsed.message || 'Unknown error');
          break;
        case 'done':
          callbacks.onDone();
          break;
      }
    } catch (parseError) {
      console.error('[SSE] JSON parse error:', parseError, 'for data:', eventData.slice(0, 500));
    }
    eventType = '';
    eventData = '';
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          const remainingLines = buffer.split('\n');
          for (const line of remainingLines) {
            if (line.startsWith('event: ')) {
              processEvent();
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            }
          }
          processEvent();
        }
        break;
      }

      const decoded = decoder.decode(value, { stream: true });
      buffer += decoded;
      // Handle both \r\n (CRLF) and \n (LF) line endings
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        // Skip SSE comments (lines starting with ':')
        if (line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event: ')) {
          // New event starts - process previous event first
          processEvent();
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        } else if (line === '') {
          // Empty line - process event
          processEvent();
        }
      }
    }
  } catch (readErr) {
    if (readErr instanceof DOMException && readErr.name === 'AbortError') return;
    callbacks.onError('__NETWORK_ERROR__');
  }
}

/**
 * Process a requirement via SSE streaming with chat-like text output.
 * Receives real-time text chunks, step completions, clarification requests,
 * and the final result.
 * @param requirement - Natural language requirement text
 * @param outputFormat - Desired output format
 * @param callbacks - Event handlers for all stream event types
 * @returns AbortController to cancel the request
 */
export function processRequirementStream(
  requirement: string,
  outputFormat: 'json' | 'markdown' = 'json',
  language: 'en' | 'zh' = 'en',
  callbacks: StreamCallbacks,
  collectTechnical: boolean = false,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/process/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirement,
      output_format: outputFormat,
      language,
      collect_technical: collectTechnical,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
        callbacks.onError(err.detail || `Request failed: ${response.status}`);
        return;
      }
      await _consumeSSE(response, callbacks);
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && /network|fetch|failed to fetch|load failed/i.test(err.message));
      callbacks.onError(
        isNetworkError ? '__NETWORK_ERROR__' : (err instanceof Error ? err.message : 'Connection failed'),
      );
    });

  return controller;
}

/**
 * Submit user answers to clarification questions for an active session.
 * @param sessionId - Active streaming session ID
 * @param answers - Map of question_id to answer
 */
export async function submitClarification(
  sessionId: string,
  answers: Record<string, string | string[]>,
): Promise<void> {
  const response = await fetch(`${API_BASE}/process/clarify/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!response.ok) {
    throw new Error(`Failed to submit clarification: ${response.status}`);
  }
}

/**
 * Resume an existing session SSE stream (replays history + continues live).
 * @param sessionId - Session ID from the original stream request
 * @param callbacks - Event handlers for all stream event types
 * @returns AbortController to cancel the request
 */
export function resumeStream(
  sessionId: string,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/process/stream/resume/${sessionId}`, {
    method: 'GET',
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        callbacks.onError(response.status === 404 ? '__SESSION_EXPIRED__' : `Resume failed: ${response.status}`);
        return;
      }
      await _consumeSSE(response, callbacks);
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && /network|fetch|failed to fetch|load failed/i.test(err.message));
      callbacks.onError(isNetworkError ? '__NETWORK_ERROR__' : (err instanceof Error ? err.message : 'Connection failed'));
    });

  return controller;
}

/**
 * Cancel an active workflow session on the backend.
 * @param sessionId - Session ID to cancel
 */
export async function cancelSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/process/cancel/${sessionId}`, { method: 'POST' });
  } catch {
    // Best-effort — ignore errors
  }
}

/**
 * Fetch the current team configuration from the backend.
 * @returns Team members and configuration
 */
export async function fetchTeamConfig(): Promise<{
  members: TeamMember[];
  max_adjustment_iterations: number;
}> {
  const response = await fetch(`${API_BASE}/team`);
  if (!response.ok) {
    throw new Error(`Failed to fetch team config: ${response.status}`);
  }
  return response.json();
}

/**
 * Check if the API backend is available.
 * @returns true if healthy
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Extend an existing completed task plan with an additional requirement via SSE.
 * The backend generates only new tasks and merges them with the existing plan.
 * @param newRequirement - The additional requirement text
 * @param existingResult - The current ProcessResult object to extend
 * @param language - Output language
 * @param callbacks - SSE event handlers (same as processRequirementStream)
 * @returns AbortController to cancel the request
 */
export function extendRequirementStream(
  newRequirement: string,
  existingResult: object,
  language: 'en' | 'zh' = 'en',
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/process/extend/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      new_requirement: newRequirement,
      existing_result: existingResult,
      language,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
        callbacks.onError(err.detail || `Request failed: ${response.status}`);
        return;
      }
      await _consumeSSE(response, callbacks);
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && /network|fetch|failed to fetch|load failed/i.test(err.message));
      callbacks.onError(
        isNetworkError ? '__NETWORK_ERROR__' : (err instanceof Error ? err.message : 'Connection failed'),
      );
    });

  return controller;
}

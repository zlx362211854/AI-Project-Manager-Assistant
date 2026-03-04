export type TaskType =
  | 'feature'
  | 'bug_fix'
  | 'improvement'
  | 'research'
  | 'documentation'
  | 'testing'
  | 'infrastructure';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface Requirement {
  title: string;
  description: string;
  type: TaskType;
  estimated_time: number | null;
}

export interface SubTask {
  id: string;
  title: string;
  description: string;
  user_story: string;
  acceptance_criteria: string[];
  technical_notes: string;
  estimated_time: number;
  priority: Priority;
  assignee: string | null;
  start_date: string | null;
  end_date: string | null;
  dependencies: string[];
  /** Transient field: set while LLM is enriching this task with user answers. */
  pending_answers?: Record<string, string | string[]>;
}

export interface ProcessResult {
  requirement: Requirement;
  subtasks: SubTask[];
  total_estimated_hours: number;
  adjustment_iterations: number;
}

export interface TeamMember {
  name: string;
  role: string;
  skills: string[];
  max_hours_per_week: number;
  current_load: number;
}

export interface ApiResponse {
  success: boolean;
  output: string;
  format: string;
}

export type WorkflowStep = 'parse' | 'decompose' | 'prioritize' | 'allocate' | 'adjust' | 'output';

export interface StepEvent {
  step: WorkflowStep;
  label: string;
  completed: WorkflowStep[];
  requirement?: Requirement;
  subtask_count?: number;
  has_conflict?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  type: 'choice' | 'text';
  options?: string[];
  allow_multiple?: boolean;
}

export interface ClarificationEvent {
  session_id: string;
  phase: string;
  context: string;
  questions: ClarificationQuestion[];
}

export interface StreamCallbacks {
  onSession: (sessionId: string) => void;
  onText: (content: string) => void;
  onStep: (event: StepEvent) => void;
  onTasksUpdate: (tasks: SubTask[]) => void;
  onTaskProcessing: (taskId: string) => void;
  onClarification: (event: ClarificationEvent) => void;
  onResult: (result: ApiResponse) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export type { PersistedSession } from '../utils/persistence';

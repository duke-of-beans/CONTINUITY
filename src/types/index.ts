/**
 * CONTINUITY Types
 * Core type definitions for session persistence
 */

// ─── Session State ───────────────────────────────────────────────

export interface SessionState {
  id: string;
  workspace: string;
  project?: string;
  timestamp: string;
  phase: string;
  completed_operations: Operation[];
  active_files: string[];
  decisions_made: string[];
  next_steps: string[];
  git_state: GitState;
  token_budget_remaining?: number;
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface Operation {
  timestamp: string;
  description: string;
  tool?: string;
  result?: 'success' | 'failure' | 'partial';
}

export interface GitState {
  branch: string;
  uncommitted: boolean;
  last_commit?: string;
}

// ─── Checkpoints ─────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  workspace: string;
  timestamp: string;
  operation: string;
  state: Partial<SessionState>;
  git_hash?: string;
  trigger: CheckpointTrigger;
}

export type CheckpointTrigger = 'manual' | 'shim' | 'kernl' | 'gitflow' | 'auto';

// ─── Decisions ───────────────────────────────────────────────────

export interface Decision {
  id: string;
  timestamp: string;
  workspace: string;
  category: DecisionCategory;
  decision: string;
  rationale: string;
  alternatives: string[];
  impact: 'high' | 'medium' | 'low';
  revisit_trigger?: string;
  session_id?: string;
}

export type DecisionCategory = 'architectural' | 'technical' | 'process' | 'tooling';

export interface DecisionQuery {
  workspace?: string;
  category?: DecisionCategory;
  keyword?: string;
  since?: string;
}

// ─── Session Records ─────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  workspace: string;
  start_time: string;
  end_time?: string;
  operations_count: number;
  ended_cleanly: boolean;
  handoff_path?: string;
}

// ─── Crash Recovery ──────────────────────────────────────────────

export interface CrashRecovery {
  detected: boolean;
  last_checkpoint?: Checkpoint;
  operations_lost: number;
  recovery_prompt: string;
  last_session?: SessionRecord;
}

// ─── Handoff Quality ─────────────────────────────────────────────

export interface HandoffQuality {
  completeness_score: number;
  missing_elements: string[];
  warnings: string[];
  suggestions: string[];
}

// ─── Compression ─────────────────────────────────────────────────

export interface CompressionResult {
  compressed: string;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
}

// ─── Config ──────────────────────────────────────────────────────

export interface ContinuityConfig {
  data_dir: string;
  sessions_dir: string;
  decisions_dir: string;
  db_path: string;
  auto_checkpoint_interval: number;
  compression_target_tokens: number;
  handoff_quality_threshold: number;
}

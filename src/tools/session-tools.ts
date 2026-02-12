/**
 * CONTINUITY Session Tools
 * save_session, load_session, checkpoint, recover_crash
 */

import { randomUUID } from 'crypto';
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContinuityDatabase } from '../storage/database.js';
import type { ContinuityConfig } from '../types/index.js';
import type { SessionState, Checkpoint, SessionRecord, CrashRecovery, Operation } from '../types/index.js';

// ─── Tool Definitions ────────────────────────────────────────────

export const sessionTools: Tool[] = [
  {
    name: 'continuity_save_session',
    description: 'Save session state and generate structured handoff. Call at session end or before token exhaustion. Generates JSON + markdown handoff in .continuity/sessions/.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Project workspace identifier (e.g., "fine-print", "gregore")' },
        phase: { type: 'string', description: 'Current work phase (e.g., "implementation", "design", "testing")' },
        completed_operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              result: { type: 'string', enum: ['success', 'failure', 'partial'] },
            },
            required: ['description'],
          },
          description: 'Operations completed this session',
        },
        active_files: { type: 'array', items: { type: 'string' }, description: 'Files currently being worked on' },
        next_steps: { type: 'array', items: { type: 'string' }, description: 'What the next session should do' },
        git_branch: { type: 'string', description: 'Current git branch' },
        warnings: { type: 'array', items: { type: 'string' }, description: 'Issues the next session should know about' },
      },
      required: ['workspace', 'phase', 'next_steps'],
    },
  },
  {
    name: 'continuity_load_session',
    description: 'Load the most recent session state for a workspace. Call at session start to resume context. Returns compressed handoff markdown.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Project workspace to load (e.g., "fine-print"). If omitted, loads most recent across all workspaces.' },
        session_id: { type: 'string', description: 'Specific session ID to load. If omitted, loads latest.' },
      },
    },
  },
  {
    name: 'continuity_checkpoint',
    description: 'Save intermediate state during work. Call every 3-5 tool calls for crash protection. Accumulates session context across calls — each checkpoint carries full running state so it can serve as a handoff if the session ends unexpectedly. Auto-escalates to a full session save every 15 checkpoints (configurable).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Project workspace identifier' },
        operation: { type: 'string', description: 'What was just completed' },
        phase: { type: 'string', description: 'Current work phase (e.g., "implementation", "debugging"). Persists across checkpoints until changed.' },
        active_files: { type: 'array', items: { type: 'string' }, description: 'Files currently being worked on (replaces previous list)' },
        next_steps: { type: 'array', items: { type: 'string' }, description: 'Immediate next steps (replaces previous list)' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'Key decisions made since last checkpoint (appended, deduplicated)' },
        warnings: { type: 'array', items: { type: 'string' }, description: 'Issues to flag (appended across checkpoints)' },
        trigger: { type: 'string', enum: ['manual', 'shim', 'kernl', 'gitflow', 'auto'], description: 'What triggered this checkpoint' },
      },
      required: ['workspace', 'operation'],
    },
  },
  {
    name: 'continuity_recover_crash',
    description: 'Detect if the last session crashed and provide recovery context. Call at session start before load_session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Workspace to check for crash. If omitted, checks all.' },
      },
    },
  },
];

// ─── Session Accumulator ─────────────────────────────────────────
// Tracks running state across checkpoints so any checkpoint
// can serve as a full handoff if the session ends unexpectedly.

interface AccumulatorState {
  workspace: string;
  phase: string;
  completed_operations: Array<{ description: string; result: string }>;
  active_files: string[];
  decisions_made: string[];
  next_steps: string[];
  warnings: string[];
  checkpoint_count: number;
  last_escalation: string | null;
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createSessionHandlers(db: ContinuityDatabase, config: ContinuityConfig) {
  // Track current session
  let currentSessionId: string | null = null;

  // Per-workspace accumulators: track running state across checkpoints
  const accumulators = new Map<string, AccumulatorState>();

  function getOrCreateAccumulator(workspace: string): AccumulatorState {
    if (!accumulators.has(workspace)) {
      accumulators.set(workspace, {
        workspace,
        phase: 'unknown',
        completed_operations: [],
        active_files: [],
        decisions_made: [],
        next_steps: [],
        warnings: [],
        checkpoint_count: 0,
        last_escalation: null,
      });
    }
    return accumulators.get(workspace)!;
  }

  function escalateToFullSave(acc: AccumulatorState): {
    handoff_path: string;
    json_path: string;
  } {
    const now = new Date().toISOString();
    const datePrefix = now.slice(0, 10);
    const timePrefix = now.slice(11, 16).replace(':', '');
    const filename = `${datePrefix}_${acc.workspace}_${timePrefix}_auto`;
    const jsonPath = join(config.sessions_dir, `${filename}.json`);
    const mdPath = join(config.sessions_dir, `${filename}.md`);

    const state: SessionState = {
      id: currentSessionId || randomUUID(),
      workspace: acc.workspace,
      timestamp: now,
      phase: acc.phase,
      completed_operations: acc.completed_operations.map(op => ({
        timestamp: now,
        description: op.description,
        result: op.result as Operation['result'] || 'success',
      })),
      active_files: acc.active_files,
      decisions_made: acc.decisions_made,
      next_steps: acc.next_steps,
      git_state: { branch: 'unknown', uncommitted: false },
      warnings: [...acc.warnings, '[AUTO-ESCALATED] Session save triggered by checkpoint threshold'],
      metadata: { auto_escalated: true, checkpoint_count: acc.checkpoint_count },
    };

    writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf-8');
    writeFileSync(mdPath, generateHandoffMarkdown(state), 'utf-8');

    acc.last_escalation = now;
    acc.checkpoint_count = 0;

    return { handoff_path: mdPath, json_path: jsonPath };
  }

  return {
    continuity_save_session: async (input: Record<string, unknown>) => {
      const workspace = input.workspace as string;
      const now = new Date().toISOString();
      const sessionId = currentSessionId || randomUUID();

      const ops = (input.completed_operations as Operation[] | undefined) || [];
      const state: SessionState = {
        id: sessionId,
        workspace,
        timestamp: now,
        phase: input.phase as string,
        completed_operations: ops.map(o => ({
          timestamp: now,
          description: o.description,
          result: o.result || 'success',
        })),
        active_files: (input.active_files as string[]) || [],
        decisions_made: [],
        next_steps: (input.next_steps as string[]) || [],
        git_state: {
          branch: (input.git_branch as string) || 'unknown',
          uncommitted: false,
        },
        warnings: (input.warnings as string[]) || [],
        metadata: {},
      };

      // Save JSON state
      const datePrefix = now.slice(0, 10);
      const timePrefix = now.slice(11, 16).replace(':', '');
      const filename = `${datePrefix}_${workspace}_${timePrefix}`;
      const jsonPath = join(config.sessions_dir, `${filename}.json`);
      const mdPath = join(config.sessions_dir, `${filename}.md`);

      writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf-8');

      // Generate markdown handoff
      const md = generateHandoffMarkdown(state);
      writeFileSync(mdPath, md, 'utf-8');

      // Update session record
      if (currentSessionId) {
        db.endSession(currentSessionId, now, ops.length, true, mdPath);
      } else {
        const record: SessionRecord = {
          id: sessionId,
          workspace,
          start_time: now,
          end_time: now,
          operations_count: ops.length,
          ended_cleanly: true,
          handoff_path: mdPath,
        };
        db.createSession(record);
      }

      // Save final checkpoint
      db.saveCheckpoint({
        id: randomUUID(),
        workspace,
        timestamp: now,
        operation: 'session_end',
        state,
        trigger: 'manual',
      });

      currentSessionId = null;

      // Clear accumulator on clean save
      accumulators.delete(workspace);

      return {
        success: true,
        session_id: sessionId,
        handoff_path: mdPath,
        json_path: jsonPath,
        operations_saved: ops.length,
      };
    },

    continuity_load_session: async (input: Record<string, unknown>) => {
      const workspace = input.workspace as string | undefined;
      const sessionId = input.session_id as string | undefined;

      // Try to load from session files
      if (!existsSync(config.sessions_dir)) {
        return { success: false, message: 'No sessions directory found. This appears to be a fresh start.' };
      }

      const files = readdirSync(config.sessions_dir).filter((f: string) => f.endsWith('.json')).sort().reverse();

      let targetFile: string | undefined;

      if (sessionId) {
        targetFile = files.find((f: string) => f.includes(sessionId));
      } else if (workspace) {
        targetFile = files.find((f: string) => f.includes(workspace));
      } else {
        targetFile = files[0];
      }

      if (!targetFile) {
        return { success: false, message: `No session found${workspace ? ` for workspace "${workspace}"` : ''}. Starting fresh.` };
      }

      const jsonPath = join(config.sessions_dir, targetFile);
      const raw = readFileSync(jsonPath, 'utf-8');
      const state = JSON.parse(raw) as SessionState;

      const ageMs = Date.now() - new Date(state.timestamp).getTime();
      const ageHours = Math.round(ageMs / 3600000 * 10) / 10;

      // Start new session tracking
      currentSessionId = randomUUID();
      db.createSession({
        id: currentSessionId,
        workspace: state.workspace,
        start_time: new Date().toISOString(),
        operations_count: 0,
        ended_cleanly: false,
      });

      const mdPath = jsonPath.replace('.json', '.md');
      const handoffMd = existsSync(mdPath) ? readFileSync(mdPath, 'utf-8') : generateHandoffMarkdown(state);

      return {
        success: true,
        session_id: state.id,
        workspace: state.workspace,
        phase: state.phase,
        age_hours: ageHours,
        next_steps: state.next_steps,
        active_files: state.active_files,
        warnings: state.warnings,
        handoff_markdown: handoffMd,
        current_session_id: currentSessionId,
      };
    },

    continuity_checkpoint: async (input: Record<string, unknown>) => {
      const workspace = input.workspace as string;
      const now = new Date().toISOString();

      // Update accumulator with new checkpoint data
      const acc = getOrCreateAccumulator(workspace);
      acc.checkpoint_count++;

      // Merge incoming data into accumulator (latest wins for scalars, append for arrays)
      if (input.phase) acc.phase = input.phase as string;
      if (input.active_files) acc.active_files = input.active_files as string[];
      if (input.next_steps) acc.next_steps = input.next_steps as string[];
      if (input.warnings) acc.warnings = [...acc.warnings, ...(input.warnings as string[])];

      // Append new decisions (deduplicated)
      const newDecisions = (input.decisions as string[]) || [];
      for (const d of newDecisions) {
        if (!acc.decisions_made.includes(d)) acc.decisions_made.push(d);
      }

      // Append completed operation from this checkpoint
      const opDescription = input.operation as string;
      acc.completed_operations.push({ description: opDescription, result: 'success' });

      // Build enriched checkpoint state (carries full accumulated context)
      const cp: Checkpoint = {
        id: randomUUID(),
        workspace,
        timestamp: now,
        operation: opDescription,
        state: {
          phase: acc.phase,
          active_files: acc.active_files,
          next_steps: acc.next_steps,
          decisions_made: acc.decisions_made,
          warnings: acc.warnings,
          completed_operations: acc.completed_operations.map(op => ({
            timestamp: now,
            description: op.description,
            result: op.result as Operation['result'],
          })),
        },
        trigger: (input.trigger as Checkpoint['trigger']) || 'manual',
      };

      db.saveCheckpoint(cp);

      if (currentSessionId) {
        db.incrementOperations(currentSessionId);
      }

      // Prune old checkpoints (keep last 50 per workspace)
      db.pruneCheckpoints(workspace, 50);

      // Auto-escalation: if checkpoint count exceeds threshold, write full handoff
      let escalated = false;
      let escalation_result: { handoff_path: string; json_path: string } | null = null;
      if (acc.checkpoint_count >= config.auto_escalation_threshold) {
        escalation_result = escalateToFullSave(acc);
        escalated = true;

        // Also update session record with handoff path
        if (currentSessionId) {
          db.endSession(currentSessionId, now, acc.completed_operations.length, true, escalation_result.handoff_path);
          // Reopen as new session (session continues, just snapshotted)
          currentSessionId = randomUUID();
          db.createSession({
            id: currentSessionId,
            workspace,
            start_time: now,
            operations_count: 0,
            ended_cleanly: false,
          });
        }
      }

      return {
        success: true,
        checkpoint_id: cp.id,
        workspace,
        operation: cp.operation,
        timestamp: now,
        checkpoint_number: acc.checkpoint_count,
        escalation_threshold: config.auto_escalation_threshold,
        auto_escalated: escalated,
        ...(escalation_result ? { handoff_path: escalation_result.handoff_path } : {}),
      };
    },

    continuity_recover_crash: async (input: Record<string, unknown>) => {
      const workspace = input.workspace as string | undefined;

      const unclean = db.getUncleanSessions(workspace);

      if (unclean.length === 0) {
        return {
          detected: false,
          operations_lost: 0,
          recovery_prompt: 'No crash detected. Last session ended cleanly.',
        };
      }

      const crashed = unclean[0];
      const lastCheckpoint = db.getLatestCheckpoint(crashed.workspace);

      const recovery: CrashRecovery = {
        detected: true,
        last_checkpoint: lastCheckpoint || undefined,
        operations_lost: lastCheckpoint ? 0 : crashed.operations_count,
        recovery_prompt: generateRecoveryPrompt(crashed, lastCheckpoint),
        last_session: crashed,
      };

      // Mark the crashed session so we don't detect it again
      db.endSession(crashed.id, new Date().toISOString(), crashed.operations_count, false);

      return recovery;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function generateHandoffMarkdown(state: SessionState): string {
  const lines: string[] = [
    `# Session Handoff: ${state.workspace}`,
    `**Saved:** ${state.timestamp}`,
    `**Phase:** ${state.phase}`,
    '',
  ];

  if (state.completed_operations.length > 0) {
    lines.push('## Completed');
    for (const op of state.completed_operations) {
      const status = op.result === 'success' ? '[OK]' : op.result === 'failure' ? '[FAIL]' : '[PARTIAL]';
      lines.push(`${status} ${op.description}`);
    }
    lines.push('');
  }

  if (state.active_files.length > 0) {
    lines.push('## Active Files');
    for (const f of state.active_files) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (state.next_steps.length > 0) {
    lines.push('## Next Steps');
    for (let i = 0; i < state.next_steps.length; i++) {
      lines.push(`${i + 1}. ${state.next_steps[i]}`);
    }
    lines.push('');
  }

  if (state.git_state.branch !== 'unknown') {
    lines.push(`## Git: ${state.git_state.branch}${state.git_state.uncommitted ? ' (uncommitted changes)' : ''}`);
    lines.push('');
  }

  if (state.warnings.length > 0) {
    lines.push('## Warnings');
    for (const w of state.warnings) {
      lines.push(`[WARN] ${w}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateRecoveryPrompt(session: SessionRecord, checkpoint: Checkpoint | null): string {
  const lines = [
    `[CRASH DETECTED] Session "${session.id}" in workspace "${session.workspace}" did not end cleanly.`,
    `Started: ${session.start_time}`,
    `Operations completed: ${session.operations_count}`,
  ];

  if (checkpoint) {
    lines.push(`Last checkpoint: "${checkpoint.operation}" at ${checkpoint.timestamp}`);
    if (checkpoint.state.next_steps && checkpoint.state.next_steps.length > 0) {
      lines.push(`Resume from: ${checkpoint.state.next_steps[0]}`);
    }
    if (checkpoint.state.active_files && checkpoint.state.active_files.length > 0) {
      lines.push(`Active files: ${checkpoint.state.active_files.join(', ')}`);
    }
  } else {
    lines.push('No checkpoint found — context may be partially lost.');
  }

  return lines.join('\n');
}

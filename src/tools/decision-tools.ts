/**
 * CONTINUITY Decision Tools
 * log_decision, query_decisions
 */

import { randomUUID } from 'crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DecisionLog } from '../storage/decision-log.js';
import type { Decision, DecisionCategory, DecisionQuery } from '../types/index.js';

// ─── Tool Definitions ────────────────────────────────────────────

export const decisionTools: Tool[] = [
  {
    name: 'continuity_log_decision',
    description: 'Record an architectural or technical decision with full rationale and alternatives considered. Prevents re-debating the same choices across sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Project workspace (e.g., "fine-print", "all" for global decisions)' },
        category: { type: 'string', enum: ['architectural', 'technical', 'process', 'tooling'], description: 'Decision category' },
        decision: { type: 'string', description: 'What was decided' },
        rationale: { type: 'string', description: 'Why this choice was made' },
        alternatives: { type: 'array', items: { type: 'string' }, description: 'What else was considered' },
        impact: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Impact level' },
        revisit_trigger: { type: 'string', description: 'Condition that would warrant reconsidering this decision' },
      },
      required: ['workspace', 'category', 'decision', 'rationale'],
    },
  },
  {
    name: 'continuity_query_decisions',
    description: 'Search the decision registry. Use to check if a decision has already been made before debating alternatives. Supports keyword search, workspace filtering, and date filtering.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string', description: 'Filter by workspace. Omit to search all workspaces.' },
        category: { type: 'string', enum: ['architectural', 'technical', 'process', 'tooling'], description: 'Filter by category' },
        keyword: { type: 'string', description: 'Search keyword (searches decision, rationale, and alternatives)' },
        since: { type: 'string', description: 'Only decisions after this ISO date' },
      },
    },
  },
];

// ─── Handler Factory ─────────────────────────────────────────────

export function createDecisionHandlers(log: DecisionLog) {
  return {
    continuity_log_decision: async (input: Record<string, unknown>) => {
      const decision: Decision = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        workspace: input.workspace as string,
        category: input.category as DecisionCategory,
        decision: input.decision as string,
        rationale: input.rationale as string,
        alternatives: (input.alternatives as string[]) || [],
        impact: (input.impact as Decision['impact']) || 'medium',
        revisit_trigger: input.revisit_trigger as string | undefined,
      };

      // Check for duplicate/conflicting decisions
      const existing = log.query({
        workspace: decision.workspace,
        keyword: decision.decision.split(' ').slice(0, 3).join(' '),
      });

      let warning: string | undefined;
      if (existing.length > 0) {
        const similar = existing[0];
        warning = `Similar decision already exists (${similar.id}): "${similar.decision}" — logged on ${similar.timestamp}. New decision recorded anyway; consider reviewing for conflicts.`;
      }

      log.append(decision);

      return {
        success: true,
        decision_id: decision.id,
        workspace: decision.workspace,
        category: decision.category,
        decision: decision.decision,
        warning,
        total_decisions: log.count(),
      };
    },

    continuity_query_decisions: async (input: Record<string, unknown>) => {
      const query: DecisionQuery = {
        workspace: input.workspace as string | undefined,
        category: input.category as DecisionCategory | undefined,
        keyword: input.keyword as string | undefined,
        since: input.since as string | undefined,
      };

      const results = log.query(query);

      return {
        total: results.length,
        decisions: results.map(d => ({
          id: d.id,
          timestamp: d.timestamp,
          workspace: d.workspace,
          category: d.category,
          decision: d.decision,
          rationale: d.rationale,
          alternatives: d.alternatives,
          impact: d.impact,
          revisit_trigger: d.revisit_trigger,
        })),
      };
    },
  };
}

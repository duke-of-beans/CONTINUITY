/**
 * CONTINUITY Utility Tools
 * compress_context, handoff_quality
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SessionState, HandoffQuality, CompressionResult } from '../types/index.js';

// ─── Tool Definitions ────────────────────────────────────────────

export const utilityTools: Tool[] = [
  {
    name: 'continuity_compress_context',
    description: 'Compress session context for efficient handoff. Takes verbose context and produces a compressed summary targeting ~1K tokens. Preserves decisions and current state, aggressively compresses history.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        full_context: { type: 'string', description: 'Full context text to compress' },
        target_tokens: { type: 'number', description: 'Target token count (default: 1000)' },
        preserve: {
          type: 'array',
          items: { type: 'string' },
          description: 'Strings that MUST appear in compressed output (e.g., critical decisions, current file paths)',
        },
      },
      required: ['full_context'],
    },
  },
  {
    name: 'continuity_handoff_quality',
    description: 'Validate that a session handoff has all critical information. Returns completeness score and suggestions. Call before save_session to ensure nothing is missing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace: { type: 'string' },
        phase: { type: 'string' },
        completed_operations: { type: 'array', items: { type: 'object' } },
        active_files: { type: 'array', items: { type: 'string' } },
        next_steps: { type: 'array', items: { type: 'string' } },
        git_branch: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
        decisions_made: { type: 'array', items: { type: 'string' } },
      },
      required: ['workspace'],
    },
  },
];

// ─── Handler Factory ─────────────────────────────────────────────

export function createUtilityHandlers() {
  return {
    continuity_compress_context: async (input: Record<string, unknown>) => {
      const fullContext = input.full_context as string;
      const targetTokens = (input.target_tokens as number) || 1000;
      const preserve = (input.preserve as string[]) || [];

      const result = compressContext(fullContext, targetTokens, preserve);
      return result;
    },

    continuity_handoff_quality: async (input: Record<string, unknown>) => {
      const quality = validateHandoff(input);
      return quality;
    },
  };
}

// ─── Compression Engine ──────────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

function compressContext(fullContext: string, targetTokens: number, preserve: string[]): CompressionResult {
  const originalTokens = estimateTokens(fullContext);

  if (originalTokens <= targetTokens) {
    return {
      compressed: fullContext,
      original_tokens: originalTokens,
      compressed_tokens: originalTokens,
      compression_ratio: 1,
    };
  }

  const lines = fullContext.split('\n');
  const preserved: string[] = [];
  const compressible: string[] = [];

  for (const line of lines) {
    const isPreserved = preserve.some(p => line.includes(p));
    const isHeader = line.startsWith('#');
    const isDecision = line.toLowerCase().includes('decision') || line.toLowerCase().includes('ratified');
    const isNextStep = line.toLowerCase().includes('next') || line.toLowerCase().includes('todo');
    const isWarning = line.includes('[WARN]') || line.includes('[FAIL]');
    const isStatus = line.includes('[OK]') || line.includes('[DONE]') || line.includes('[WIP]');

    if (isPreserved || isHeader || isDecision || isNextStep || isWarning) {
      preserved.push(line);
    } else if (isStatus) {
      // Compress status lines to just the description
      preserved.push(line.replace(/\[OK\]\s*/, '').replace(/\[DONE\]\s*/, '').trim());
    } else {
      compressible.push(line);
    }
  }

  // Build compressed output
  let compressed = preserved.join('\n');
  let currentTokens = estimateTokens(compressed);

  // Add compressible lines if we have budget
  if (currentTokens < targetTokens) {
    const budget = targetTokens - currentTokens;
    const budgetChars = budget * 4;
    let added = 0;

    for (const line of compressible) {
      if (added + line.length > budgetChars) break;
      compressed += '\n' + line;
      added += line.length;
    }
  }

  const compressedTokens = estimateTokens(compressed);

  return {
    compressed: compressed.trim(),
    original_tokens: originalTokens,
    compressed_tokens: compressedTokens,
    compression_ratio: Math.round((originalTokens / Math.max(compressedTokens, 1)) * 10) / 10,
  };
}

// ─── Handoff Validation ──────────────────────────────────────────

function validateHandoff(input: Record<string, unknown>): HandoffQuality {
  const missing: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;
  const maxScore = 100;

  // Required fields (60 points)
  if (input.workspace) score += 10; else missing.push('workspace');
  if (input.phase) score += 10; else missing.push('phase');
  if (input.next_steps && (input.next_steps as string[]).length > 0) score += 20; else missing.push('next_steps');
  if (input.active_files && (input.active_files as string[]).length > 0) score += 10; else missing.push('active_files');
  if (input.completed_operations && (input.completed_operations as unknown[]).length > 0) score += 10; else missing.push('completed_operations');

  // Optional but valuable (40 points)
  if (input.git_branch) score += 10; else suggestions.push('Add git branch for context');
  if (input.warnings && (input.warnings as string[]).length > 0) score += 5;
  if (input.decisions_made && (input.decisions_made as string[]).length > 0) score += 15; else suggestions.push('Log any decisions made this session');
  if (input.phase && typeof input.phase === 'string' && input.phase.length > 3) score += 10; else suggestions.push('Be specific about the phase (e.g., "implementing Layer 5 hub visualization" not just "implementation")');

  // Quality checks
  const nextSteps = (input.next_steps as string[]) || [];
  if (nextSteps.length > 0 && nextSteps[0].length < 10) {
    warnings.push('First next_step is very short — be specific about what to do');
    score -= 5;
  }
  if (nextSteps.length > 10) {
    warnings.push('Too many next_steps (>10). Prioritize the top 3-5.');
    score -= 5;
  }

  return {
    completeness_score: Math.max(0, Math.min(maxScore, score)),
    missing_elements: missing,
    warnings,
    suggestions,
  };
}

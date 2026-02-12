/**
 * CONTINUITY Decision Log
 * Append-only JSONL storage for architectural decisions
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Decision, DecisionQuery, ContinuityConfig } from '../types/index.js';

export class DecisionLog {
  private logPath: string;

  constructor(config: ContinuityConfig) {
    this.logPath = join(config.decisions_dir, 'decisions.jsonl');

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, '', 'utf-8');
    }
  }

  append(decision: Decision): void {
    const line = JSON.stringify(decision) + '\n';
    appendFileSync(this.logPath, line, 'utf-8');
  }

  query(q: DecisionQuery): Decision[] {
    const all = this.readAll();
    return all.filter(d => {
      if (q.workspace && d.workspace !== q.workspace) return false;
      if (q.category && d.category !== q.category) return false;
      if (q.since && d.timestamp < q.since) return false;
      if (q.keyword) {
        const kw = q.keyword.toLowerCase();
        const searchable = `${d.decision} ${d.rationale} ${d.alternatives.join(' ')}`.toLowerCase();
        if (!searchable.includes(kw)) return false;
      }
      return true;
    });
  }

  getAll(workspace?: string): Decision[] {
    const all = this.readAll();
    if (workspace) return all.filter(d => d.workspace === workspace);
    return all;
  }

  getById(id: string): Decision | null {
    return this.readAll().find(d => d.id === id) ?? null;
  }

  count(): number {
    return this.readAll().length;
  }

  private readAll(): Decision[] {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, 'utf-8').trim();
    if (!content) return [];

    return content.split('\n').filter((line: string) => line.trim()).map((line: string) => {
      try {
        return JSON.parse(line) as Decision;
      } catch {
        return null;
      }
    }).filter((d: Decision | null): d is Decision => d !== null);
  }
}

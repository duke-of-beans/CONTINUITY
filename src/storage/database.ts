/**
 * CONTINUITY Database
 * SQLite storage for checkpoints, sessions, and fast queries
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Checkpoint, SessionRecord, ContinuityConfig } from '../types/index.js';

export class ContinuityDatabase {
  private db: Database.Database;

  constructor(config: ContinuityConfig) {
    const dbDir = dirname(config.db_path);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.db_path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        state_json TEXT NOT NULL,
        git_hash TEXT,
        trigger_source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        operations_count INTEGER NOT NULL DEFAULT 0,
        ended_cleanly INTEGER NOT NULL DEFAULT 0,
        handoff_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace
        ON checkpoints(workspace);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp
        ON checkpoints(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace
        ON sessions(workspace);
      CREATE INDEX IF NOT EXISTS idx_sessions_start_time
        ON sessions(start_time DESC);
    `);
  }

  // ─── Checkpoints ─────────────────────────────────────────────

  saveCheckpoint(cp: Checkpoint): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, workspace, timestamp, operation, state_json, git_hash, trigger_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(cp.id, cp.workspace, cp.timestamp, cp.operation, JSON.stringify(cp.state), cp.git_hash ?? null, cp.trigger);
  }

  getLatestCheckpoint(workspace: string): Checkpoint | null {
    const row = this.db.prepare(`
      SELECT * FROM checkpoints WHERE workspace = ? ORDER BY timestamp DESC LIMIT 1
    `).get(workspace) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToCheckpoint(row);
  }

  getCheckpoints(workspace: string, limit: number = 10): Checkpoint[] {
    const rows = this.db.prepare(`
      SELECT * FROM checkpoints WHERE workspace = ? ORDER BY timestamp DESC LIMIT ?
    `).all(workspace, limit) as Record<string, unknown>[];

    return rows.map(r => this.rowToCheckpoint(r));
  }

  private rowToCheckpoint(row: Record<string, unknown>): Checkpoint {
    return {
      id: row.id as string,
      workspace: row.workspace as string,
      timestamp: row.timestamp as string,
      operation: row.operation as string,
      state: JSON.parse(row.state_json as string),
      git_hash: row.git_hash as string | undefined,
      trigger: row.trigger_source as Checkpoint['trigger'],
    };
  }

  // ─── Sessions ────────────────────────────────────────────────

  createSession(session: SessionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, workspace, start_time, operations_count, ended_cleanly, handoff_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(session.id, session.workspace, session.start_time, session.operations_count, session.ended_cleanly ? 1 : 0, session.handoff_path ?? null);
  }

  endSession(id: string, endTime: string, operationsCount: number, endedCleanly: boolean, handoffPath?: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET end_time = ?, operations_count = ?, ended_cleanly = ?, handoff_path = ?
      WHERE id = ?
    `);
    stmt.run(endTime, operationsCount, endedCleanly ? 1 : 0, handoffPath ?? null, id);
  }

  getLatestSession(workspace: string): SessionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions WHERE workspace = ? ORDER BY start_time DESC LIMIT 1
    `).get(workspace) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToSession(row);
  }

  getUncleanSessions(workspace?: string): SessionRecord[] {
    const query = workspace
      ? `SELECT * FROM sessions WHERE ended_cleanly = 0 AND workspace = ? ORDER BY start_time DESC`
      : `SELECT * FROM sessions WHERE ended_cleanly = 0 ORDER BY start_time DESC`;
    const rows = workspace
      ? this.db.prepare(query).all(workspace) as Record<string, unknown>[]
      : this.db.prepare(query).all() as Record<string, unknown>[];

    return rows.map(r => this.rowToSession(r));
  }

  incrementOperations(sessionId: string): void {
    this.db.prepare(`UPDATE sessions SET operations_count = operations_count + 1 WHERE id = ?`).run(sessionId);
  }

  private rowToSession(row: Record<string, unknown>): SessionRecord {
    return {
      id: row.id as string,
      workspace: row.workspace as string,
      start_time: row.start_time as string,
      end_time: row.end_time as string | undefined,
      operations_count: row.operations_count as number,
      ended_cleanly: (row.ended_cleanly as number) === 1,
      handoff_path: row.handoff_path as string | undefined,
    };
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  pruneCheckpoints(workspace: string, keepCount: number = 50): number {
    const result = this.db.prepare(`
      DELETE FROM checkpoints WHERE workspace = ? AND id NOT IN (
        SELECT id FROM checkpoints WHERE workspace = ? ORDER BY timestamp DESC LIMIT ?
      )
    `).run(workspace, workspace, keepCount);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

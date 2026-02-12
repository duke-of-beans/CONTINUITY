/**
 * CONTINUITY Config
 * Configuration loading and defaults
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ContinuityConfig } from '../types/index.js';

const DEFAULT_DATA_DIR = process.env.CONTINUITY_DATA_DIR || 'D:/Dev/.continuity';

const DEFAULTS: ContinuityConfig = {
  data_dir: DEFAULT_DATA_DIR,
  sessions_dir: join(DEFAULT_DATA_DIR, 'sessions'),
  decisions_dir: join(DEFAULT_DATA_DIR, 'decisions'),
  db_path: join(DEFAULT_DATA_DIR, 'state.db'),
  auto_checkpoint_interval: 5,
  auto_escalation_threshold: 15,
  compression_target_tokens: 1000,
  handoff_quality_threshold: 80,
};

export function loadConfig(): ContinuityConfig {
  const configPath = join(DEFAULT_DATA_DIR, 'config.json');

  // Ensure directories exist
  for (const dir of [DEFAULTS.data_dir, DEFAULTS.sessions_dir, DEFAULTS.decisions_dir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULTS, null, 2), 'utf-8');
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ContinuityConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

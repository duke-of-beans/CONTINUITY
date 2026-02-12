/**
 * CONTINUITY MCP Server
 * Session State Persistence for AI Systems
 * Version: 1.0.0
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { ContinuityDatabase } from '../storage/database.js';
import { DecisionLog } from '../storage/decision-log.js';
import { loadConfig } from '../storage/config.js';

import { sessionTools, createSessionHandlers } from '../tools/session-tools.js';
import { decisionTools, createDecisionHandlers } from '../tools/decision-tools.js';
import { utilityTools, createUtilityHandlers } from '../tools/utility-tools.js';

export class ContinuityMCPServer {
  private server: Server;
  private db: ContinuityDatabase;
  private decisionLog: DecisionLog;
  private tools: Map<string, Tool>;
  private handlers: Map<string, (input: Record<string, unknown>) => Promise<unknown>>;

  constructor() {
    const config = loadConfig();
    this.db = new ContinuityDatabase(config);
    this.decisionLog = new DecisionLog(config);
    this.tools = new Map();
    this.handlers = new Map();

    this.server = new Server(
      { name: 'continuity-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this.registerAllTools(config);
    this.setupRequestHandlers();
    this.setupErrorHandling();
  }

  private registerAllTools(config: ReturnType<typeof loadConfig>): void {
    // Session tools (4)
    const sessionHandlers = createSessionHandlers(this.db, config);
    for (const tool of sessionTools) {
      this.tools.set(tool.name, tool);
      const handler = sessionHandlers[tool.name as keyof typeof sessionHandlers];
      if (handler) this.handlers.set(tool.name, handler as (input: Record<string, unknown>) => Promise<unknown>);
    }

    // Decision tools (2)
    const decisionHandlers = createDecisionHandlers(this.decisionLog);
    for (const tool of decisionTools) {
      this.tools.set(tool.name, tool);
      const handler = decisionHandlers[tool.name as keyof typeof decisionHandlers];
      if (handler) this.handlers.set(tool.name, handler as (input: Record<string, unknown>) => Promise<unknown>);
    }

    // Utility tools (2)
    const utilHandlers = createUtilityHandlers();
    for (const tool of utilityTools) {
      this.tools.set(tool.name, tool);
      const handler = utilHandlers[tool.name as keyof typeof utilHandlers];
      if (handler) this.handlers.set(tool.name, handler as (input: Record<string, unknown>) => Promise<unknown>);
    }

    // Log registration
    console.error(`[CONTINUITY] Registered ${this.tools.size} tools:`);
    for (const name of this.tools.keys()) {
      console.error(`  - ${name}`);
    }
  }

  private setupRequestHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.tools.values()),
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = this.handlers.get(name);

      if (!handler) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
      }

      try {
        const result = await handler((args as Record<string, unknown>) || {});
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[CONTINUITY] Error in ${name}:`, message);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[CONTINUITY] Server error:', error);
    };

    process.on('SIGINT', () => {
      console.error('[CONTINUITY] Shutting down...');
      this.db.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error('[CONTINUITY] Shutting down...');
      this.db.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[CONTINUITY] MCP server running (8 tools, SQLite + JSONL)');
  }
}

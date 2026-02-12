/**
 * CONTINUITY MCP - Entry Point
 * Version: 1.0.0
 *
 * Session State Persistence for AI Systems
 * Crashes lose seconds, not hours.
 */

import { ContinuityMCPServer } from './server/mcp-server.js';

const server = new ContinuityMCPServer();
server.run().catch(console.error);

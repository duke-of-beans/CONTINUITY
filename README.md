# CONTINUITY

**Session State Persistence for AI Systems**

Crashes lose seconds, not hours. Every AI instance picks up exactly where the last one left off.

---

## What It Does

CONTINUITY is an MCP (Model Context Protocol) server that gives AI assistants persistent memory across sessions. It solves the biggest pain point in AI-assisted development: context loss.

**The problem:** AI sessions crash, hit token limits, or end naturally — and the next session starts from scratch. Architectural decisions get re-debated. Completed work gets forgotten. Hours vanish into reconstruction.

**The solution:** 8 tools that handle session persistence, crash recovery, decision tracking, and context compression. Plug it into Claude Desktop (or any MCP-compatible client) and session continuity becomes automatic.

## Tools

| Tool | Purpose |
|------|---------|
| `continuity_save_session` | Generate structured handoff at session end |
| `continuity_load_session` | Resume from last session with compressed context |
| `continuity_checkpoint` | Lightweight state save every 3-5 operations |
| `continuity_recover_crash` | Detect crash and auto-recover from last checkpoint |
| `continuity_log_decision` | Record architectural decisions with rationale + alternatives |
| `continuity_query_decisions` | Search decision history to prevent re-debates |
| `continuity_compress_context` | Smart context compression (20K tokens → 1K) |
| `continuity_handoff_quality` | Validate handoff completeness before saving |

## Architecture

```
Storage Layer
├── SQLite (state.db)        → Checkpoints, session records, fast queries
├── JSONL (decisions.jsonl)  → Append-only architectural decision log
└── JSON (sessions/*.json)   → Full session state snapshots + markdown handoffs

Tool Modules
├── session-tools.ts    → save, load, checkpoint, crash recovery
├── decision-tools.ts   → log + query architectural decisions
└── utility-tools.ts    → compression, handoff validation

Server
└── mcp-server.ts       → MCP SDK wiring, tool registration, error handling
```

## Installation

### Prerequisites

- Node.js >= 18
- Claude Desktop (or any MCP-compatible client)

### Setup

```bash
git clone https://github.com/duke-of-beans/CONTINUITY.git
cd CONTINUITY
npm install --include=dev
npm run build
```

### Wire into Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "CONTINUITY": {
      "command": "node",
      "args": ["path/to/CONTINUITY/dist/index.js"],
      "env": {
        "CONTINUITY_DATA_DIR": "path/to/your/.continuity"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see 8 new tools available.

### Configuration

Set `CONTINUITY_DATA_DIR` to control where state is stored. Default: `D:/Dev/.continuity`

The data directory structure:

```
.continuity/
├── config.json          # Settings (auto-generated with defaults)
├── state.db             # SQLite database
├── sessions/            # JSON state snapshots + markdown handoffs
└── decisions/           # JSONL decision log
```

## Usage

### Session Lifecycle

```
Session Start:
  → continuity_recover_crash()     # Check for unclean shutdown
  → continuity_load_session()      # Load last session context

During Work:
  → continuity_checkpoint()        # Every 3-5 tool calls
  → continuity_log_decision()      # When architectural choices are made

Session End:
  → continuity_handoff_quality()   # Validate completeness
  → continuity_save_session()      # Generate handoff for next session
```

### Decision Registry

Stop re-debating the same architectural choices:

```
continuity_log_decision({
  workspace: "my-project",
  category: "architectural",
  decision: "Use PostgreSQL over Neo4j",
  rationale: "Simpler ops, AGE extension covers graph needs",
  alternatives: ["Neo4j", "DGraph", "ArangoDB"],
  impact: "high",
  revisit_trigger: "If graph queries exceed 10K nodes/sec"
})
```

Later, in a new session:

```
continuity_query_decisions({
  keyword: "database",
  workspace: "my-project"
})
// → Returns the decision with full rationale, preventing re-debate
```

### Crash Recovery

If a session dies without calling `save_session`:

```
continuity_recover_crash({ workspace: "my-project" })
// → Detects unclean shutdown
// → Returns last checkpoint with active files, next steps, and recovery prompt
// → Zero context loss if checkpoints were regular
```

## Integration

CONTINUITY is designed to work alongside other MCP servers:

- **SHIM** can call `continuity_checkpoint` after quality checks
- **KERNL** can call `continuity_save_session` at `mark_complete`
- Any MCP server can trigger checkpoints via the standard tool interface

## Why This Exists

AI assistants are stateless by design. Every session starts fresh. This is fine for one-off questions but catastrophic for multi-session projects where architectural decisions compound and context is everything.

CONTINUITY bridges that gap. It's the difference between a collaborator who remembers your project and one who asks "so what are we working on?" every morning.

## License

MIT — Use it, fork it, build on it.

## Author

David Kirsch — [@duke-of-beans](https://github.com/duke-of-beans)

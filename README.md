# CONTINUITY

Session state persistence for MCP systems: crash recovery, a decision registry, and context compression for long-running AI sessions.

## The problem

A long working session with an AI assistant accumulates real state — decisions made, approaches tried and rejected, context that took real back-and-forth to establish. A crash, a context-window limit, or just closing the window loses all of it, and re-establishing that state by hand is expensive.

## What it does

CONTINUITY checkpoints session state as it develops, logs decisions explicitly rather than letting them live only in conversation history, and compresses context so a session can be resumed without replaying the entire prior conversation to get back to where it left off.

## Part of a system

CONTINUITY is the session-recovery layer in a larger cognitive-infrastructure stack. See [davidkirsch.me/builds](https://davidkirsch.me/builds) for the rest.

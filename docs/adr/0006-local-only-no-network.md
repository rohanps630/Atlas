# 0006 - Local-only; no network in the pipeline

Status: Accepted

## Context
The tool is pointed at client code under NDA. Any step that sends code off the machine (e.g.,
a cloud embedding API) is a potential contract violation and a leak vector.

## Decision
The analysis pipeline makes no network calls at runtime. All extraction, graph building, and
querying happen on the local machine against local files. (ADR 0001 already removed the one
component that would have needed the network.)

## Consequences
- Safe to run against any client code without external-data concerns.
- No service to run, no API keys, no quota.
- **Boundary note:** this covers *the tool's pipeline*. If you then feed the generated map or
  context packs to a cloud coding agent (Claude Code / Kiro), that code transits per-session
  under that provider's terms — a much smaller, per-request surface than bulk-uploading a repo,
  but not literally zero. If true zero-egress is ever required, that implies a local LLM for
  the agent too — a separate, heavier decision, out of scope here.

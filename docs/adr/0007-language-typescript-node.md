# 0007 - Build the tool in TypeScript/Node

Status: Accepted

## Context
The tool needs: a CLI, filesystem work, the ability to drive a TypeScript parser for the
first extractor, and an MCP server later (Phase 3). It will be maintained by one person for
years, so familiarity and ease of maintenance outweigh any theoretical performance edge.

## Decision
Build the tool in TypeScript on Node. The first extractor uses the TypeScript Compiler API
(or ts-morph). Phase 0 ships a plain-JS CLI stub that runs with no build step; Phase 1
migrates to a real TypeScript build + test setup.

## Consequences
- Matches the owner's frontend work — lowest maintenance friction.
- Native fit for the first (TypeScript) extractor and the MCP server ecosystem.
- The core stays dependency-light; extractors may take dependencies (ADR 0005).
- Alternative considered: Go (great single-binary CLI). Rejected for now on familiarity
  grounds; revisit only if Node maintenance becomes painful.

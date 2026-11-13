# Project Development Practices & Engineering Style

This document defines the software engineering methodology, version control workflow, and code quality standards for Open Chat.
Consult this document to maintain consistency across development sessions.

---

## 1. Core Development Methodology

### 1.1 Vertical Slice Delivery
- Every development unit is delivered as an end-to-end vertical slice.
- Each slice must connect storage, engine logic, and presentation.
- Every slice must conclude with:
  1. Automated test suite execution (`npm test`).
  2. Concrete user-viewable terminal verification steps.

### 1.2 Two-Layer Project Memory Model
- **Crème Layer (`docs/PROJECT_MEMORY.md` Section 1)**:
  - Authoritative, conflict-resolved source of truth for the system's current state.
  - New LLM sessions must read this section first to pop off with minimal context window consumption.
- **Session Audit Log (`docs/PROJECT_MEMORY.md` Section 2)**:
  - Chronological append-only log of raw directives (`DIR-XXX`).
  - Records evolving decisions and supersession history.

### 1.3 Technical Writing Standard (STE-Inspired)
- Write in concise, declarative, active-voice sentences.
- Use tabular comparisons and structured ASCII diagrams.
- Avoid filler words, marketing language, and conversational preambles.
- Optimize documentation for low token consumption and fast LLM parsing.

### 1.4 GitHub Projects & Issue-Driven Development
- Central project board: [Open-Souce-Alt/projects/1](https://github.com/orgs/Open-Souce-Alt/projects/1).
- Board workflow stages: `Backlog` $\rightarrow$ `Ready` $\rightarrow$ `In progress` $\rightarrow$ `In review` $\rightarrow$ `Done`.
- User specifies requirements, bug reports, and roadmap priorities as issues linked to Project #1.
- Agent investigates issues, moves cards to `In progress`, implements vertical slices, runs tests, and updates cards to `Done` referencing issue numbers in commit messages.
- Agent files discovered bugs or technical debt as new issues and links them to the board.

---

## 2. Version Control Workflow (Jujutsu / `jj`)

The project uses Jujutsu (`jj`) colocated with Git for local-first version control.

### 2.1 Branching & Bookmark Conventions
- Development proceeds along clean, linear milestone bookmarks:
  - `phase-0`: Project initialization, memory architecture, specifications.
  - `phase-1`: Core SQLite storage, VFS DAG engine, interactive Unix shell.
  - `phase-2`: Fastify HTTP + WebSocket daemon, client-server decoupling.
  - `phase-3`: Normalized auth state machine, WhatsApp Baileys adapter, discovery sync.
- The working copy (`@`) sits as an empty commit on top of the active phase bookmark.

### 2.2 Squash & Refinement Discipline
- Do not commit fragmented fixups or micro-commits to the public history.
- Bugfixes, type refinements, and documentation updates made during a phase are squashed directly into that phase bookmark:
  ```bash
  jj squash --into phase-X
  ```

### 2.3 Local-Only Exclusion Policy
- Development-only skills, agent metadata, sample pages, and linter caches must never be tracked or pushed to Git.
- Maintain exclusions inside `.git/info/exclude` rather than dirtying `.gitignore`:
  - `llm-memory-req.html`
  - `.agents/`
  - `.claude/`
  - `tools/`
  - `.oxlintrc.json`
  - `skills-lock.json`

### 2.4 Autonomous Commits and Pushes for Task Slices
- With the GitHub Projects issue-driven workflow adopted, the assistant commits and pushes autonomously upon verified completion of each issue, task, or vertical slice.
- Commits must use Conventional Commits and reference issue numbers when applicable (e.g. `feat(core): ... (closes #X)`).
- Before committing and pushing, all validation gates (`npx oxlint --import-plugin`, `npx tsc`, and `npm test`) must pass cleanly.

---

## 3. Code Standards & Style Guide

All TypeScript code must strictly adhere to the Google TypeScript Style Guide and Anti-Slop verification rules.

### 3.1 Control Flow & Braces
- Braces (`{}`) are mandatory around all control flow statements (`if`, `else`, `for`, `while`), even for single-line bodies.
- Single-line statement bodies without braces are prohibited:
  ```typescript
  // PROHIBITED
  if (!dir) return null;

  // MANDATORY
  if (!dir) {
    return null;
  }
  ```

### 3.2 Error Handling
- Catch clauses must type errors as `unknown`:
  ```typescript
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // handle error
  }
  ```
- Prohibit `catch (err: any)`.
- Never leave empty catch blocks without an explicit explanatory comment.

### 3.3 Zero-`any` & Strict Types
- Prohibit the `any` type in application and library code.
- Prefer `interface` over type literal aliases for all object shapes.
- Restrict `type` to domain unions and primitive aliases:
  ```typescript
  export type PlatformId = 'whatsapp' | 'system';
  ```
- Use strict domain types instead of generic strings for identifiers and platforms.

### 3.4 Non-Null Assertions & Boundary Checks
- Avoid the non-null assertion operator (`!`). Use explicit runtime guards or defensive checks.
- Every necessary type assertion (`as TargetType`) must carry a preceding `SAFETY:` justification comment:
  ```typescript
  // SAFETY: SQLite query selects all columns from directories table matching DirectoryRow
  const dir = db.prepare('SELECT * FROM directories WHERE id = ?').get(id) as DirectoryRow | null;
  ```

### 3.5 Anti-Slop Data Contracts
- Prohibit open/unsafe dictionaries (`Record<string, unknown>` or `Record<string, any>`).
- Define explicit scalar value unions for arbitrary payloads:
  ```typescript
  export type MetadataScalar = string | number | boolean | null;
  export type MetadataRecord = Record<string, MetadataScalar>;
  ```
- Avoid runtime `typeof` branching on unparsed I/O; normalize or validate data at input boundaries.
- Return named interface contracts rather than widening to anonymous object shapes.

---

## 4. Platform Integration Principles

### 4.1 Protocol Over Browser Automation
- Do not use headless browser automation (Puppeteer, Selenium, injected scripts) for messaging integrations. Browser injection triggers client-integrity heuristics and account-wide device session revocation.
- Connect via native protocol-level WebSocket connections (`@whiskeysockets/baileys`).
- Register as recognized native companion devices (e.g., `Browsers.macOS('Desktop')`).

### 4.2 Handshake & Reconnect Resilience
- Always handle post-pairing server reconnects (`restartRequired: 515` / `connectionClosed: 428`).
- Never delete or wipe credential directories during intermediate pairing restarts.
- Only purge local auth directories on explicit logout (`DisconnectReason.loggedOut: 401`) or upon user-requested clean resets (`--clean`).

### 4.3 Streaming Discovery & Recency
- Do not assume external data arrives in a single synchronous burst.
- Handle incremental stream events (`messaging-history.set`, `chats.upsert`, `chats.update`).
- Track true conversation timestamps (`conversationTimestamp`), not system clock sync times. Inactive chats with no messages must store `0` and display `-`.

---

## 5. Verification Commands

Before concluding any slice or phase, execute the three validation pillars:

```bash
# 1. Anti-Slop Static Linter
npx oxlint --import-plugin

# 2. TypeScript Compiler Check
npx tsc

# 3. Automated Test Suites
npm test
```
All three checks must pass with zero errors and zero warnings.

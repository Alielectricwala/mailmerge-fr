# AGENTS.md — FocusRealm Mail Merge

## Mission
Build a reliable, polished, maintainable mail-merge and outreach application for FocusRealm. Optimize for correctness, simplicity, usability, and trust—not feature count.

## Product pillars
1. **Data:** Import CSV/XLSX contacts; support field mapping, deduplication, validation, and missing-data detection.
2. **Personalization:** Reusable subject/body templates, merge fields, fallback values, recipient-level previews, and clear missing-field errors.
3. **Enrichment:** Allow optional research tools to enrich company and contact records with source evidence, confidence, and verification status. Never treat guesses as verified facts.
4. **Sending:** Use the configured SpaceMail SMTP account. Keep human approval, test mode, suppression lists, sending limits, and recipient-level logs.
5. **Follow-up:** Reuse available mailbox functionality to identify replies, bounces, and unsubscribes when technically supported.
6. **Visibility:** Make every important action, status, and failure understandable.

## Engineering rules
- Inspect the existing repository, configuration, database, and tests before changing architecture.
- Reuse reliable existing modules; do not duplicate working infrastructure without a clear reason.
- Establish the smallest coherent end-to-end workflow before adding advanced features.
- Use typed interfaces, clear module boundaries, migrations where appropriate, and maintainable error handling.
- Never hardcode credentials, expose secrets, or commit local environment files.
- Never send real external emails without explicit human approval.
- Retries must not cause duplicate sends. Record send attempts and outcomes.
- Do not invent data or silently overwrite existing contact information during enrichment.
- Keep changes scoped. Avoid unrelated refactors and unnecessary dependencies.
- Do not claim a feature or test works unless you have actually verified it.

## Design direction
Use the supplied FocusRealm workspace screenshot as the visual reference.

- Light, professional workspace; pale blue-grey background and white surfaces.
- Primary blue accents, dark navy text, muted slate secondary text, subtle borders and shadows.
- Inter or a similar clean sans-serif font.
- Rounded cards, clear spacing, readable tables, restrained icons, and consistent component sizes.
- Centralize design tokens and use shared components.
- Prioritize desktop usability and responsive layouts.
- Avoid visual clutter, oversized dashboards, excessive gradients, and unnecessary animations.

## Delivery workflow
1. Inspect and summarize the existing codebase and available infrastructure.
2. Propose a short phased implementation plan with acceptance criteria.
3. Implement one coherent phase at a time.
4. Write or update tests for important logic and failure cases.
5. Run relevant tests, type checks, linting, and builds; report actual results.
6. Fix regressions before proceeding.
7. Summarize changed files, verified behavior, remaining risks, and the next recommended step.

## Scope discipline
The initial goal is a dependable workflow: import contacts → map fields → create a template → preview and validate recipients → approve → send through the configured mailbox → record results.

Defer advanced analytics, automated sequences, multiple providers, and sophisticated AI agents until the core workflow passes its tests.

When requirements are ambiguous, inspect the code and choose the simplest reversible option. Ask only when a decision materially affects security, data integrity, external sending, or architecture.
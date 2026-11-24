# Data Protection Impact Assessment — Pipelixr

Status: launch baseline; review before production and whenever messaging, AI, providers, data categories, or automated decision scope materially changes.

## Processing assessed

Pipelixr receives business WhatsApp conversations through the configured connector, stores limited customer identifiers and message content, classifies intent, retrieves seller-supplied business facts, assists with replies and follow-up, records orders/outcomes, and exposes workspace exports and deletion tools. The seller is controller for customer data; the Pipelixr operator is processor. The operator is controller for account, billing, security, and support data.

## Necessity and proportionality

- Purpose: help a seller manage active customer conversations and business operations.
- Minimum launch scope: one-to-one service replies after inbound contact; marketing only with separate recorded evidence; groups disabled unless individually authorized; Status-to-Cash disabled.
- Retention: message content defaults to 90 days; deletion jobs and privacy suppressions prevent unwanted re-import; longer-lived consent, billing, security, and legal records are limited to compliance needs.
- Transparency: public privacy, AI, DPA, acceptable-use, billing, and subprocessor notices; versioned acceptance; visible seller controls.
- Rights: JSON export, access/correction/restriction/objection/erasure requests, contact deletion, and account deletion.

## Risk assessment and controls

| Risk | Initial risk | Controls | Residual risk |
|---|---:|---|---:|
| Unauthorized cross-tenant access | High | Authenticated subject, owner-scoped business lookup, per-document business checks, generated validators, isolation tests | Low |
| Unwanted or unlawful marketing | High | Separate marketing consent ledger, evidence requirement, STOP recognition, immediate suppression, service-only default | Medium |
| AI invents a price, promise, payment or policy | High | Seller playbook, explicit guardrails, grounded prompts, review queues, feedback, high-impact human responsibility notice | Medium |
| Connector/provider compromise or enforcement | High | Encrypted provider credentials, restricted access, connection incident records, kill switch, revocation/deletion flow, documented contingency | Medium/High |
| Excessive retention or re-import after erasure | High | Configured expiry, scheduled deletion, privacy suppression key, workspace/account deletion | Low/Medium |
| Sensitive data sent to AI providers | High | Data minimization, contractual subprocessor controls, public AI notice, seller instruction not to upload unnecessary sensitive data | Medium |
| Incorrect inferred intent or profiling | Medium | Operational assistance only, no solely automated significant decision, seller review and correction, objection/restriction workflow | Low/Medium |
| Breach not handled promptly | High | Incident runbook, audit records, named roles, 72-hour NDPC assessment deadline | Medium |

## Consultation and approval

Before launch, the operator must fill in its legal identity, privacy contact, provider entities/regions, lawful transfer safeguards, insurance/contract posture, and named incident roles. Counsel or the DPO/privacy lead must confirm whether the operator or any customer is a data controller/processor of major importance and whether NDPC registration or additional filings apply.

Decision: acceptable for limited launch only after the open items above, tests, security review, vendor DPAs, and incident tabletop are complete. The unofficial connector remains a separately accepted technical/platform risk and is not cured by this DPIA.

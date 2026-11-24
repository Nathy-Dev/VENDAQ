# Security Incident and Personal-Data Breach Runbook

## Immediate response

1. Open an incident record with UTC time, reporter, systems, suspected data, affected tenants, and current owner.
2. Preserve logs and evidence. Do not alter source evidence or share customer data in general chat channels.
3. Contain safely: revoke affected credentials, disable automation or the workspace kill switch, restrict access, and isolate compromised integrations. Do not erase evidence.
4. Assess confidentiality, integrity, availability, affected people, categories/volume, likely consequences, ongoing exposure, cross-border impact, and whether customer-controlled data is involved.
5. Notify impacted business controllers without undue delay with known facts, mitigation, and a cadence for updates.

## Regulatory clock

The privacy lead starts the clock at awareness, not at final confirmation. Where the Nigeria Data Protection Act duty applies and the breach is likely to risk individuals' rights and freedoms, prepare notification to the Nigeria Data Protection Commission within 72 hours of awareness. If notification is late, document reasons. Controllers decide their own notifications; as processor, Pipelixr supplies facts without undue delay. Seek counsel for the exact duty and current NDPC channel.

Notification assessment must document: nature of breach; affected categories and approximate numbers; likely consequences; containment/remediation; contact point; processor/controller roles; cross-border or other regulator duties; and whether direct notice to affected people is required because of high risk.

## Communications

- Use verified contacts and the minimum necessary detail.
- Do not speculate, assign blame, or promise an outcome before evidence supports it.
- Coordinate regulator, customer, individual, provider, law-enforcement, insurer, and public statements through the incident lead and counsel.
- Give affected people clear protective actions when direct notice is required.

## Recovery and closure

Restore from known-good state, rotate secrets, validate tenant isolation and message suppression, monitor recurrence, and obtain owner approval before re-enabling automation. Within ten business days, complete a post-incident report with root cause, timeline, impact, notifications, evidence, control improvements, owners, and deadlines. Update the DPIA, ROPA, training, vendor record, and tests.

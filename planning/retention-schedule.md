# Data Retention Schedule

Retention is a maximum, not a minimum. Legal holds must be documented, scoped, reviewed, and released promptly.

| Record | Default | Trigger/action |
|---|---:|---|
| Customer message content and interaction media metadata | 90 days | Expire automatically; workspace may use a shorter approved period |
| Deleted contact suppression key | Account life or justified anti-reimport period | Keep only hashed/private identity needed to prevent re-import |
| Customer profile, conversation, orders and outcomes | Account life | Delete on verified contact erasure or account deletion, subject to lawful exceptions |
| Marketing consent and withdrawal evidence | Consent life + 6 years proposed | Retain enough to prove permission/withdrawal; counsel must approve period |
| Privacy requests and resolution evidence | 6 years proposed | Minimize response attachments; counsel must approve period |
| Legal acceptance records | Contract life + 6 years proposed | Immutable version/evidence; counsel must approve period |
| Billing/payment/accounting records | 6 years proposed or statutory period | Do not store card details; confirm Nigerian tax/accounting requirements |
| Authentication sessions | Active session plus short security period | Revoke on account deletion/security event |
| Security and incident logs | 12 months normally; 6 years for material incident file proposed | Restrict access and minimize message content |
| Backups | Defined backup rotation, target <= 35 days | Logical deletion immediately; expiry through backup rotation; document restore re-deletion process |
| Account deletion job record | Minimal completion evidence for 6 years proposed | Must not retain deleted workspace content |

Before production, the privacy lead and counsel must replace every “proposed” period with an approved period and reconcile it with code, provider settings, contracts, backups, tax law, limitation periods, and customer promises.

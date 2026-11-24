# Internal Subprocessor Register

The public page is `/legal/subprocessors`. This register is the operational source of truth and must be reconciled before launch and after every infrastructure change.

| Provider | Service/data | Entity & location | DPA/SCC or safeguard | Security review | Notice date | Owner |
|---|---|---|---|---|---|---|
| Convex | Backend/database/functions; account, workspace, conversation data | REQUIRED | REQUIRED | REQUIRED | Initial | Engineering |
| Vercel | Web hosting/request delivery | REQUIRED | REQUIRED | REQUIRED | Initial | Engineering |
| Configured AI providers | Prompt/context, classification, generation/transcription | REQUIRED per provider | REQUIRED | REQUIRED | Initial/change | AI owner |
| Google | Optional OAuth identity | REQUIRED | REQUIRED | REQUIRED | Initial | Auth owner |
| Paystack | Checkout, payment and subscription records | REQUIRED | REQUIRED | REQUIRED | Initial | Finance |
| Cloudinary | Media handling if enabled | REQUIRED | REQUIRED | REQUIRED | Initial | Engineering |
| Messaging connection infrastructure | Authorized message transport and connection data | REQUIRED | REQUIRED | REQUIRED | Initial/change | Messaging owner |

No provider may receive production personal data until procurement records the contracting entity, processing purpose, data categories, hosting/processing locations, subprocessors, retention/deletion, breach notification, audit terms, transfer basis, security evidence, and business owner approval. Remove providers that are not actually enabled.

# Revdesk — Forms (parked)

Locked 2026-09-04. Parked on Later. Do not start before dummy remote and a first-class editor.

Manuals contain **blank forms**. Filling one is an **operational record**, not a manual revision.

| Object | Where it lives | When |
|---|---|---|
| Blank form as a leaf / appendix | Same book, same LEP/rev as the procedure that cites it | Ingest + editor, when a book actually has forms |
| Filled, signed instance | Recordkeeping, not `issued/` | Later service |

Put a digital-forms service on the roadmap. Do not mix blanks and instances.

## AC 120-78B

Guidance for electronic signatures, electronic recordkeeping, and electronic manuals. It is **not** a PDF/A or third-party CA mandate. A 78B-shaped system is achievable without PAdES/DocuSign:

- unique identity of the signer
- authentication
- captured intent to sign
- integrity (hash of the signed payload; alter the data, the signature is dead)
- audit trail
- retention / retrieval for the FAR that applies to that record

Do **not** market “FAA-approved signatures.” The operator’s accepted electronic recordkeeping program is the legal object.

## Webhook-out

Operator names a URL. Revdesk POSTs the form instance (id, template rev, payload, signature envelope, hashes). Their ops / SMS / mx system is the system of record if they want it.

Revdesk at minimum keeps the controlled blank (revisioned with the book) and may keep a hash log of instances. Do not become the W&B database unless they opt in.

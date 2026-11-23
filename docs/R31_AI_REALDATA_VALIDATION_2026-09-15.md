# R31 AI Real-Data Validation Authority

## Immutable canonical serving authority

The preserved optimized serving database used during R31 implementation was independently reconstructed from the Horse-DB recovery bundle and verified before testing:

- SQLite bytes: `196677632`
- SHA-256: `20d5fc704b097852fd07a4161ccf21cf9090924e1db80343d7bce2b34eee5603`
- horses: `78089`
- people: `26646`
- horse-person relationships: `110469`
- `PRAGMA integrity_check = ok`
- foreign-key violations: `0`

The immutable authority was not migrated or modified. R31 testing used a separate copy.

## Disposable R31 copy

The validation copy applies Newsroom/AI migrations `0014` through `0021`, then executes the same read-only research broker exposed to Gemini/DeepSeek.

Run under a clean dependency installation with:

```bash
AI_REALDATA_DB=/absolute/path/to/verified/horse-registry-v5-turso-serving-upload.sqlite npm run test:ai-realdata
```

`tests/ai-realdata.test.ts` copies the supplied database before applying migrations.

## Required assertions

The gate verifies:

- Latin `CHABOCK`, Persian `چابك`, and registration `IR3311775` resolve canonical horse `#1`;
- structured filtered registry browsing returns bounded rows, exact total and continuation state;
- people search and person-linked horses are bounded/canonical;
- prolific descendant research remains bounded instead of flooding context;
- whole-population registry aggregation examines exactly `78,089` active canonical horses;
- published content search works after R31 content migrations.

Earlier implementation-session measurements additionally exercised relationship classification, pedigree/relationship coefficients, Horse Intelligence and pairing-analysis semantics on real records.

## Safety rule

Never point the test at a production writable authority. The harness itself creates a disposable copy, but the supplied input path must still be a verified offline/local authority.

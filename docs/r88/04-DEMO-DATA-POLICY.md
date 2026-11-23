# Demo data, ingestion and presentation policy

## 1. Implemented isolation

The generator `tools/generate-r88-demo.mjs` consumes `src/demo/seed-r88.mjs` and executes the actual pedigree/date source modules. It writes only static demo JSON and generated browser modules under `public/`. It does not connect to the registry database. Every fixture belongs to `synthetic:r88`; entities carry `is_demo: true`, synthetic provenance and no authority claim. Synthetic IDs and names are visibly prefixed. Report/credential identifiers are explicitly non-valid demo identifiers.

Browser saves and inquiries use only `horse-db:synthetic-r88:v1`. Reset touches only this namespace. No real phone numbers, personal addresses, financial account numbers, license holders or diagnoses are required to demonstrate functionality. The request dialog warns against entering them. No message is sent and no payment is collected. Private-browser storage may disappear; the UI reports unavailable storage rather than claiming delivery.

Both new pages use `noindex,nofollow,noarchive` metadata; Worker routes also set noindex headers. This is discoverability guidance, not access control. Put a client-only demonstration behind access control when confidentiality is required.

## 2. What not to fake

Never fabricate an official verification, issuer endorsement, real person's listing, completed sale, real lab result, customer testimonial, payment receipt, live availability, conversion metric, current market price, or demand estimate. Never set a production capability flag to true just because the workbench shows the flow.

A synthetic pedigree coefficient can be an actual calculation on synthetic inputs. Label BOTH aspects: data synthetic, algorithm real/versioned. Show depth, coverage and assumptions. A coefficient of zero with no known ancestors is not a confident outcross. Unknown or cyclic data cannot become a green healthy/safe badge.

Avoid generated photorealistic images presented as identified real horses. Monograms used in R88 are intentionally unambiguous. A future stock/illustrative image requires source, permitted use and an illustration label, never automatic attachment to a real horse identity.

## 3. Permitted acquisition ladder

First use client-provided data under a written permission and publication policy. Next use owner/provider self-submissions with explicit field-level publication choices. Next negotiate structured exports or API contracts with registries, event organizers and laboratories. Public webpages are research leads; public access is not a blanket database republication license (research source RIGHTS-01).

Do not scrape personal contacts or copy competitor pedigrees/photos merely to make a demo appear populated. Do not bypass authentication, rate limits or technical access controls. Check provider terms and data rights separately; robots.txt alone does not establish a license.

If automated intake is authorized, create an adapter with an allowlisted domain, published rate cap, timeout, retry budget, source URL, retrieval timestamp, payload checksum, license/permission reference, parser version and revocation contact. Stage records; do not write directly to horses from a crawler.

## 4. Required staging data model for the next agent

Use `source_imports` and existing mutation journal where possible. Add staging rows with `batch_id`, `source_record_id`, `raw_payload_sha256`, `parser_version`, `source_url`, `observed_at`, `permission_ref`, `candidate_horse_ids`, `validation_errors`, `review_status` and reviewer identity. Keep the raw licensed payload in private storage, not a public response.

Match strong identifiers by issuer/namespace first. Names, transliteration and parent links identify candidates only; do not auto-merge on a fuzzy score. Preserve old public IDs as redirects. Unknown parents are unknown, not newly invented founders with fabricated names. Ambiguous dates retain source calendar and precision. A report cannot establish parentage, ownership and clinical health all at once.

For results, preserve event/class/round/horse/rider/source revision keys. Deduplicate on source identity and content hash. Corrections supersede earlier imported facts with a visible audit trail, not silent history deletion.

## 5. Controlled promotion from demo to live

Never rename `DEMO-*` to make it look authentic. A real record must enter through a reviewed real-data path and receive a new canonical identity or explicit reviewed linkage. Demo records remain isolated or are deleted. Remove synthetic search indexing, analytics and sitemap entries from production. Add a release assertion that no `synthetic:r88` or `DEMO-NOT-VALID` entity reaches public canonical API responses.

## 6. Demonstration script

Open the workbench in English, search a synthetic ID, open a horse and navigate to a parent/owner. Show a provider category, open its non-valid credential and create a browser-only request. Move the request through contacted and closed, emphasizing that nothing was delivered. Show full-sibling pairing at 25% and the missing-ancestry case at 0% with its warning. Open the business model; show the loss-making pilot before the conditional growth case. Switch to Persian on a narrow screen. End on the coverage page showing what is not live.

The demonstration succeeds when the client understands both the intended experience and the remaining operating work, not when the client mistakes placeholders for a working national registry.

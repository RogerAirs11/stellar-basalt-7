# Iranian commercial model and practical launch economics

Prepared 2026-10-03. Read the source ledger in `06-RESEARCH-SOURCES.md`; source identifiers below refer to that ledger. This is a product/operating model, not a revenue guarantee, investment recommendation or a verified local development quotation. No customer accounts, signed contracts or actual platform sales were available.

## 1. Commercial conclusion

Do not sell this as a private replacement for federation authority. The client is right to challenge revenue that depends on official registration powers, mandatory certificates or privileged access that a private operator may not possess. Partnership can be helpful, but the business must still provide value without those privileges.

My recommended entry offer is a **trusted horse record plus a paid farm workspace and professional response tools**. The public registry attracts and informs; recurring paid work pays for reliable operation. A general horse directory with many pages is not by itself a defensible subscription.

Start with a narrow operational problem: a breeder/club can organize its real herd, give staff limited access, track user-entered due dates, maintain evidence and share an accurate sale dossier. Professional profiles then connect that work to veterinarians, farriers, trainers, transporters and other providers through consented requests. This is a hypothesis to test with paid users, not something the research proves will succeed.

The network is valuable only when records are maintained and providers respond. Reserve real budget for data operators, customer onboarding, correction disputes, support and reconciliation. Hosting is a small part of the model, not the business's total maintenance cost.

## 2. What current evidence does and does not establish

**Domestic overlap already exists.** Sheyhe publicly advertises bilingual pedigree/horse information, multiple breeds, stallions, offspring/results, sales and equipment. Chaharnal publishes horse/equipment listings and riding-related discovery/content. These observed product surfaces show that basic information plus classifieds is not an untouched category. They do not establish either competitor's revenue, traffic, trustworthiness or transaction success. Sources: IR-02, IR-03.

**International patterns are useful, but prices do not transfer directly.** HorseTelex advertises annual PLUS/TOP subscriptions (observed EUR22.50/EUR75), while ehorses advertises seller exposure subscriptions (observed Premium EUR59.98/Premium Plus EUR99.99 per month). This supports exploring paid professional tools and visibility around a free discovery layer. It does not prove that Iranian users will pay comparable converted prices. Sources: INT-01, INT-02.

**Do not invent the total market.** Iran's report to the 2025 WAHO conference describes approximately 1,000-1,200 registered Arabian foals per year. That is a breed-specific annual flow, not the total Iranian horse population, all farms, all active riders or a count of paying prospects. The older population figures on the same page must not be presented as current. Source: IR-01.

**The most important missing evidence is local willingness to pay.** We did not verify a current census of commercial farms, service providers, active online buyers, completed horse sales or software budgets. Build a bottom-up prospect list with permission and interviews rather than estimating revenue from advertised horse prices. A high-priced horse does not imply its owner will buy a software subscription.

## 3. Competitor lessons and positioning

| Observed product | What to learn | What not to assume | Proposed differentiation to test |
|---|---|---|---|
| Sheyhe | Pedigree, offspring/results and classifieds already belong together | Official source claim proves every record is current or reusable | Per-assertion provenance, correction turnaround and useful private farm work |
| Chaharnal | Horse and equipment discovery can share distribution | An asking price equals a sale or platform GMV | Evidence-linked listings and responsive professional inbox |
| HorseTelex | Free discovery can coexist with paid professional capabilities | Foreign annual prices represent Iranian willingness to pay | Affordable, local-language workflows with measurable time saved |
| ehorses | Sellers may pay for tools/exposure rather than only transaction fees | Exposure guarantees sale, or success commissions are easy to collect | Clearly sponsored placement, seller workflow and honest lead measurement |

These are strategic interpretations of observed public pages, not an exhaustive competitive usability or financial audit. Keep a dated quarterly competitor checklist: onboarding, search, pedigree evidence, contact privacy, listing freshness, response workflow, plan terms and mobile accessibility. Do not crawl their private or restricted data to fill this platform.

## 4. Three first offers, with explicit pilot hypotheses

| Offer | Initial scope worth testing | Example price hypothesis | Main variable cost hypothesis |
|---|---|---:|---:|
| Farm workspace | Private herd collections, staff grants, user-configured reminders, evidence organization, permitted exports/dossiers | 1,900,000 toman/month | 300,000 toman/account/month |
| Professional tools | Claimed profile, service area, consented inbox, request status, response reporting | 490,000 toman/month | 75,000 toman/account/month |
| Sponsored visibility | Clearly labeled time-limited promoted listing/profile, real impression/contact reporting | 290,000 toman per promotion | 45,000 toman/promotion |

Every number in this table is an **unvalidated pricing/cost experiment**, not a sourced Iranian market tariff. Workspace/provider production functionality and billing are continuation work, not secretly completed by the R88 demo. Sell only the scope actually delivered under the pilot agreement.

Keep basic public identity/pedigree access and correction submission free where publication rights permit. Never sell an official stamp, hide material uncertainty for paid users, or allow sponsorship to alter scientific breeding results. Paid formatting is not evidence verification. A paid account is not a grant to another person's private horse data.

Use limits that match costs: a defined number of staff, reminders, dossier generations and onboarding hours. Do not promise unlimited manual data cleaning at a low subscription price. Price complex migration/onboarding separately from recurring subscription only after measuring operator hours. Quote data-entry work by accepted clean records plus conflict-resolution time, not raw row count.

## 5. Costs supported by published supplier data

Zarinpal's published standard charge observed on 2026-10-03 is 0.5% of the transaction capped at 16,000 toman, plus 500 toman; Shaparak charges are additional. The calculator uses the standard charge, not an introductory promotion, and rounds the percentage upward for planning. Confirm actual merchant terms before launch. Source: COST-01.

Liara's published IaaS example is 2 GB memory / 1 vCPU / 20 GB disk at 1,475,000 toman per month, with IPv4 and traffic extra. This is a vendor price reference, not a recommended complete architecture or proof that the existing Worker application can be deployed there unchanged. Choose the actual runtime and measure database, storage, traffic and backup requirements. Source: COST-02.

Kavenegar publishes account plans, but account subscription and message usage are different costs. Obtain route-specific OTP/notification pricing, template approval, throughput and delivery terms. Do not insert an invented universal SMS unit price into the financial model. Source: COST-03.

Vendor pages are observations as of the stated date. Refresh quotes before purchase and at each pricing review; do not use foreign exchange assumptions as a substitute for actual local quotations.

## 6. The implemented calculator and its limitations

The page `/business-model/` uses `src/commerce/economics.ts` through generated JavaScript. It is bilingual, editable and tested. It deliberately shows a loss for the default pilot scenario. It is not a payment SDK, accounting ledger or forecast calibrated to real customers.

For each product: `revenue = units * unit_price`; `variable_cost = units * unit_variable_cost`; `gateway_cost = units * standard_fee(unit_price)`; `contribution = revenue - variable_cost - gateway_cost`. Operating surplus before tax subtracts fixed monthly cost. Farm and professional subscription revenue are MRR; promotions are not.

The one-transaction-per-unit assumption is explicit. Bundles, annual prepayment, partial refunds, installments and negotiated merchant terms change fees/cash timing. Do not reuse this estimator to settle actual invoices.

### Illustrative monthly scenarios, all amounts in toman

| Metric | Pilot hypothesis | Growth hypothesis |
|---|---:|---:|
| Farm subscribers | 20 | 60 |
| Professional subscribers | 60 | 120 |
| Promotions sold in month | 40 | 100 |
| Gross revenue | 79,000,000 | 201,800,000 |
| Recurring portion / MRR | 67,400,000 | 172,800,000 |
| Modeled variable cost | 12,300,000 | 31,500,000 |
| Modeled Zarinpal fee | 455,000 | 1,149,000 |
| Contribution before fixed overhead | 66,245,000 | 169,151,000 |
| Fixed overhead hypothesis | 110,000,000 | 110,000,000 |
| **Operating surplus before tax** | **-43,755,000** | **+59,151,000** |

The positive growth result is conditional arithmetic, not evidence that those customers can be acquired, retained or supported at this cost. Fixed costs may step up as customer count grows. The model excludes initial development recovery, taxes, Shaparak fees, refunds, bad debt, financing and any founder opportunity cost not explicitly included. It also assumes full monthly collection and does not model acquisition ramp or churn.

Default fixed overhead allocation is another editable hypothesis: 35m engineering maintenance, 50m data/support operations, 15m acquisition, 6m infrastructure and 4m accounting/administration. These are budget allowances, not verified salaries or staffing market rates. The variable support allowance must cover incremental work beyond the fixed team's capacity, rather than double-counting the same staff hours. Replace these assumptions with quotes and measured timesheets.

### Break-even and sensitivity

At the example farm price and variable cost, farm contribution is 1,590,000 toman after the modeled 10,000-toman gateway charge. Farm-only break-even against 110m overhead is **70 farms**. With 60 professional accounts and 40 monthly promotions contributing at the example prices, **48 farms** are needed. Those are mathematical thresholds, not validated market capacity.

Six months at the flat pilot loss would consume 262,530,000 toman of operating cash before development and excluded costs. This is not a recommended fundraising target: an actual runway budget needs acquisition ramp, collections, churn, taxes and contingency. At the same volume, every additional 10m of fixed cost reduces surplus by exactly 10m. At low scale, a few hours of unpaid manual work per account can erase apparent margins.

Do not fund the business from hoped-for ad volume. Recurring workspace utility should carry a credible portion of operating cost; promotions are supplementary and should be measured independently.

## 7. How to validate demand without overbuilding

Choose one or two regions where the team can personally recruit and support farms/clubs. Interview 20 consenting prospects across breeders, clubs, service providers and buyers. Ask for a recent real workflow, current tool, time spent, mistakes, decision maker and budget process. Record rejected offers and unwillingness to switch; do not lead the interview with a list of features or treat compliments as commitments.

Offer five farms and ten professionals a bounded paid pilot. Human onboarding is acceptable and useful, but record its time. A farm should import a real permissioned herd and complete a useful task in its first session. A professional should receive and acknowledge a valid consented request; buying a page with no lead value is not success.

Proposed go/no-go rule: at least three of five farms renew after two paid months, with observed support/data cost leaving positive direct contribution. This is a proposed internal decision threshold, not a published benchmark. The cohort is small and cannot establish national demand, but it is stronger evidence than demo engagement.

Track weekly meaningful activity, correction turnaround, request qualification, provider acknowledgement, second payment, churn reason and support minutes. Do not mix staff testing, synthetic requests, free accounts or one-off promotions with paid retention. Pause acquisition when response quality or data backlog becomes unreliable.

Initial distribution experiments: permissioned club/farm partnerships, assisted herd migration, shareable dossiers, organizer result links and provider referrals. Measure qualified activations and retained contribution per channel. Avoid broad paid advertising until one niche workflow retains users.

## 8. Client's 17 requested development categories

The table below estimates **remaining phase-one hardening/integration effort for this existing codebase**, not rebuilding everything from scratch. These are author planning ranges, not verified Iranian vendor quotes. They assume the missing original assets/lockfile can be restored, the scope is frozen, and one production topology is selected. Novel service/billing expansion and advanced scientific research are separately scoped.

| Category | Remaining hours, planning range | Included boundary |
|---|---:|---|
| UI/UX | 32-56 | Approve compact responsive layouts and real journey states across the separate skins. |
| Database | 24-48 | Additive command/version/provenance repairs; selected-provider tests. |
| Web application integration | 40-64 | Connect existing registry workflows; no duplicate backend per skin. |
| Admin panel | 24-40 | Focused review queues and safe operational commands. |
| Users and access | 24-40 | Atomic grants, organization membership and privacy matrix. |
| Horse profiles | 24-40 | Evidence/source labels, unknown data, authorized edits. |
| Pedigree | 24-48 | Independent reference fixtures, graph quality and cache invalidation. |
| Search and filters | 24-40 | Persian normalization, stable identifiers, URL state and query bounds. |
| Competition records | 16-32 | Source-attributed entry/import and correction; no assumed live feed. |
| Verification workflow | 24-40 | Issuer/scope, claim review and provenance; not an official registry mandate. |
| Photos and documents | 24-48 | Quarantine, access control and private delivery. |
| Security and backup | 32-56 | Abuse controls, restore drill and basic observability. |
| Login/registration/SMS | 16-32 | Actual delivery adapter validation and honest failures. |
| Server/domain deployment | 16-24 | Chosen runtime deployment and rollback; vendor usage costs separate. |
| Initial import setup | 24-48 | Permissioned sample mapping, dry-run and duplicate handling; bulk entry separate. |
| Testing and fixes | 48-80 | Hosted integration, cross-skin journeys and accessibility review. |
| Final release | 16-24 | Migration rehearsal, operator handoff and invited pilot. |
| **Total** | **432-760** | No duplicate addition of the agent-ticket estimates |

To quote in toman, multiply these hours by the **actual written blended rate** from the selected team, then add separately quoted fixed services and a transparently stated risk allowance. Do not pretend an invented hourly number is a current Iranian market rate. As a purely arithmetic example, a hypothetical 600,000-toman blended hour would produce the amount shown below; this is not a recommended rate or a supplier quotation.

At that hypothetical rate: **259,200,000-456,000,000 toman** before risk allowance, tax and external costs. Replace the rate before presenting a binding proposal.

A conditional delivery planning range for the registry-first phase is **8-12 calendar weeks with two engineers plus part-time QA/design and an available data reviewer**, after repository restoration and scope approval. It is not a promise of this audit session and does not mean the whole super-app can be completed in that window. Integration/provider wait time, imported-data quality and five-frontend parity can extend it.

Phase two should be split. Production professional requests, farm workspace and verified subscription billing are a separate commercial tranche; budget and schedule them from P11-P20 with the selected team. Advanced genetics should first add reviewed report provenance and reproductive tracking, then independently validated analyses. A **6-12-week planning window for a narrowly scoped specialist phase** is plausible only after lab/data agreements, domain reviewer availability and acceptance fixtures; genomic prediction or a clinically validated mating optimizer is not included. Laboratory tests, expert review, licensed datasets and liability/operating costs are external line items.

## 9. Annual maintenance and costs beyond development

Do not quote a flat hosting fee as annual support. Separate engineering maintenance, operations and variable vendor spend. In the illustrative 110m/month fixed-cost budget, annual fixed overhead would be 1.32 billion toman before variable costs, tax and initial development. This is a scenario, not a market quotation or a minimum viable staffing requirement.

For a real annual agreement specify support hours, response windows, included bug/security updates, browser/vendor changes, backup verification, restore drill frequency and exclusions. Add measured data-entry/review hours, source-license fees, moderation, customer onboarding and accounting. Include hosting/database/object storage/egress, domain renewal, email/SMS, monitoring, payment fees, external scientific review and legal/data agreements separately.

Have a price-review mechanism rather than promising unchanged unlimited support indefinitely. Track vendor and staff cost changes with dated quotes; do not manufacture a precise inflation forecast. Clarify that feature development is different from bug repair and that customer-requested manual data cleanup has an allowance or per-job price.

## 10. Additional opportunities, ordered by evidence requirements

**Near-term:** paid onboarding/migration, farm staff workflow, seller dossiers and professional inquiry tools. They can be tested with a small customer cohort and measured labor savings.

**After reliable demand:** organizer result-management contracts, laboratory intake partnerships, equipment merchant campaigns and sponsored stud/profile visibility. Each needs its own data rights, buyer and support workflow. Paid visibility must remain visibly separate from scientific or credential judgments.

**Later only:** appointment booking, transport coordination, real equipment checkout, broad social networking, native apps, data/API licensing and advanced breeding decisions. Booking requires capacity/cancellation operations; a directory card is not fulfillment. Aggregated data products require rights and privacy safeguards. Horse sale commissions or escrow should not be the first revenue promise: transaction verification, disputes and settlement are substantial separate problems.

Do not sell supposed official registration, fabricated breeder rankings, guaranteed healthy foals, guaranteed horse sales, scraped contact databases, or private genetic reports. Do not assume affiliate/insurance income without an actual partner agreement and review of the actual service model.

## 11. Business page deployment and governance

The implemented page is an internal/demo explainer with noindex metadata, source observation dates and editable assumptions. Link it for client/investor review, not as a live checkout or public price contract. A future public pricing page must come from the real versioned billing catalog and actual supported features.

Review source tariffs before launch and periodically thereafter. When real customer cohorts exist, update assumptions with dates and sample sizes; do not publish private financial data accidentally. The owner of the commercial model should approve offer changes alongside the engineer and data/support operator. A realistic business is built from fulfilled recurring value and retained paying users, not from adding every possible horse-related feature.

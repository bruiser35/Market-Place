# Prompt to Print → PrintWear integration

Status: implemented and tested locally; not activated on either live Site. No production environment values, database migrations or live catalogue records have been changed.

## Existing infrastructure and scope

Both applications remain on their existing ChatGPT Sites / Cloudflare Worker hosting, with their existing D1 `DB` and R2 `FILES` bindings. Prompt to Print retains its existing admin PIN cookie authorization and all download/payment/generation code. PrintWear retains its Sites identity/owner allowlist, products, assets, pricing rules and approval flow.

Prompt to Print prepares the same final raster/colour pipeline used by its existing admin download function, requesting 300 DPI PNG output. Native effective DPI is measured before that export, so interpolation does not hide a low-resolution source. The transfer does not clean, recolour or resize that production PNG again on receipt. A source master in PrintWear means the finished PNG received from Prompt to Print, not the pre-edit original upload.

The original generation prompt is included when available. Actual original creation date is unknown in the present editor and is explicitly stored as null; receipt time is recorded separately. A new unique product ID is assigned only after metadata, embeddings and all files have arrived.

## Workflow

1. An authenticated Prompt to Print administrator explicitly confirms the artwork belongs to the business and presses **SEND TO PRINTWEAR** beside existing admin downloads.
2. Browser snapshots final front/back production PNGs, native resolution, physical sizes, SHA-256 checksums and small vision thumbnails. Normal downloads remain independent.
3. The same-origin sender API checks the real admin cookie, validates the manifest, and reserves an idempotent receipt in PrintWear.
4. The sending server analyses thumbnails and the labelled prompt with OpenAI Responses structured output (`PRINTWEAR_METADATA_MODEL`, default `gpt-6-luna`). It creates a `text-embedding-3-small` 256-dimensional embedding of the validated metadata.
5. PNGs stream one side at a time through the authorized sender to the signed receiving API. PrintWear checks exact bytes, PNG CRCs, alpha, dimensions, clipping, metadata DPI and declared native DPI.
6. PrintWear generates a separate low-resolution, permanently watermarked preview. Full production bytes are preserved unchanged in private R2 objects.
7. Completion creates a draft in the existing products/assets catalogue, using existing single/pair default prices. Metadata, provenance, vectors and search buckets are committed atomically with the receipt/product link.
8. The owner reviews images, quality issues, source provenance, metadata uncertainties and price, edits as needed, and explicitly approves the draft.
9. Only published records appear in keyword or semantic retrieval. Native PrintWear artwork uses the same index on approval. Voice and text both call the same catalogue search endpoint.

No customer artwork is transferred automatically. There are no download-triggered hooks, automatic publication, new subscriptions, payment changes or advertising actions.

## Native PrintWear AI Catalogue section

The owner-only **AI catalogue** tab analyses artwork already prepared in PrintWear, not only artwork transferred from Prompt to Print. Artwork Prep has an explicit checked option to analyse and attach metadata when saving a draft; it can be turned off to save files without calling AI. The analysis button works on saved drafts and accepts an optional factual creation brief.

The server reads private final PNGs, performs authoritative PNG/print checks, creates temporary small unwatermarked vision previews (never customer previews), and calls the same signed Prompt to Print AI service. It attaches structured visual metadata, visible quality flags and an embedding to the existing product. It does not alter the master PNG or the saved price. Unchanged retries reuse the analysis; same-draft leases prevent overlapping runs. A default 100-analysis/day allowance and 5/minute limit protect cost.

The owner can inspect/edit category, title, search attributes and price before approval. Visible AI quality flags must be reviewed/resolved before publication. When the semantic service is configured, native artwork must have attached analysis metadata before approval. Software quality checks and explicit human approval still apply; AI does not certify perfection.

## Endpoints

### Prompt to Print

- `POST /api/admin/printwear/transfer`: reserve receipt, analyse final previews and attach metadata/vector.
- `PUT /api/admin/printwear/transfer/{importId}/files/{front|back}`: stream one PNG.
- `POST /api/admin/printwear/transfer/{importId}/complete`: finish or return the existing completed receipt.
- `GET /api/admin/printwear/transfer/{importId}`: recover status.
- `POST /api/admin/printwear/analyse`: signed native PrintWear image-analysis service returning metadata, quality flags and embedding.
- `POST /api/admin/printwear/embedding`: signed server-only embedding service for PrintWear catalogue/query indexing.

### PrintWear

- `POST /api/admin/design-imports`: validate/reserve a stable source identity.
- `PUT /api/admin/design-imports/{importId}/metadata`: store validated metadata and embedding once.
- `PUT /api/admin/design-imports/{importId}/files/{front|back}`: checksum-checked staged PNG upload.
- `POST /api/admin/design-imports/{importId}/complete`: atomically create or recover one draft.
- `GET /api/admin/design-imports/{importId}`: signed receipt/status lookup.
- `POST /api/admin/products/{productId}/analyse`: owner-only analysis/quality checks and metadata attachment for an existing draft.
- `POST /api/search`: natural-language hybrid catalogue search; keyword fallback on provider failure.
- Existing admin product GET includes metadata; existing PATCH supports `action: metadata` with optional administrator-approved `priceCents` and reindexing.

## Security

Browser actions require Prompt to Print's existing `isAdminRequest` and exact same-origin checks. Jodie/customer sessions do not authorize this transfer. Client flags are never trusted as authorization. Embedding requests require service signatures rather than browser admin cookies.

Server calls use HMAC-SHA256 over timestamp, method, path and body checksum, with a five-minute timestamp window and constant-time signature comparison. Actual payload checksums must match the signed digest. Both Sites require a shared, randomly generated secret of at least 32 characters, configured only server-side. Native AI analysis also requires PrintWear owner identity and same-origin authorization. No secrets are returned to the browser or stored in source.

PrintWear's owner-private platform gateway also requires its own `OAI-Sites-Authorization` bearer credential on sender calls. That gateway token is distinct from the HMAC secret and confers no browser identity. Supported service access was present in the Site metadata during inspection; validity/renewal must be verified during activation. Do not make the Site public to bypass this boundary.

Limits: 24 MiB per PNG, 25 megapixels, 355 mm maximum width, 550 mm maximum height, two distinct sides, 1.2 MiB thumbnail/manifest payload, schema-bounded metadata. PNG scanline inspection avoids allocating a full-size RGBA frame inside a 128 MB Worker. Original/source and customer files remain private; only watermarked previews of published products are served anonymously.

New import reservations are capped at 10/minute, file uploads at 30/minute; uncached semantic search is subject to per-user/IP and global minute limits, plus a default 1,000/day embedding-request allowance. Native image analysis has a separate 5/minute and default 100/day allowance. Query cache stores only a hash and vector, not raw query text. Failed provider calls consume allowance conservatively. These are request caps, not a guaranteed dollar spending limit; set provider billing alerts/limits too. AI analysis happens only on deliberate admin transfer; retrying after metadata is saved reuses it.

Stable source IDs include side, final PNG checksum, physical dimensions and native effective DPI. Job name or label changes do not create another listing for the same source. Unique source constraints and completion leases prevent duplicate products. Partial transfers retain their receipt and finished sides for safe retry. Failed finalization cleans up newly copied objects; incomplete staged imports remain private and should be reviewed/retained under an agreed operational policy.

## New PrintWear migrations

Apply through the normal Sites version deployment, after backup and approval:

- `drizzle/0001_flawless_squadron_supreme.sql`: adds `design_imports`, `design_import_files`, `artwork_metadata`, `catalogue_embeddings`, `search_buckets`, `bridge_rate_limits` and indexes.
- `drizzle/0002_boring_thunderbolt_ross.sql`: adds `query_embedding_cache`.

These are additive. They do not rewrite existing products, payments, users or files. Prompt to Print needs **no database migration**.

## Required runtime configuration — never paste values into chat or Git

| Site | Key | Value/purpose |
| --- | --- | --- |
| Both | `PRINTWEAR_IMPORT_SECRET` | Same fresh 32+ character random secret; add as a secret, do not reuse/replace existing payment or AI credentials |
| Prompt to Print | `PRINTWEAR_URL` | `https://printwear.jamiegreen351.chatgpt.site` (the destination origin) |
| Prompt to Print | `PRINTWEAR_SITE_ACCESS_TOKEN` | Supported private PrintWear Site service credential; secret |
| Prompt to Print | `OPENAI_API_KEY` | Reuse the existing server-side key; do not overwrite it |
| Prompt to Print | `PRINTWEAR_METADATA_MODEL` | Optional explicit approved vision/structured-output model; default `gpt-6-luna`; verify account access at activation |
| PrintWear | `PTP_EMBEDDING_URL` | `https://prompttoprint.com.au/api/admin/printwear/embedding` |
| PrintWear | `PRINTWEAR_AI_REQUESTS_PER_DAY` | Optional embedding-call allowance, default 1,000, bounded to 1–10,000 |
| PrintWear | `PRINTWEAR_ANALYSES_PER_DAY` | Optional native image-analysis allowance, default 100, bounded to 1–1,000 |
| PrintWear | `ADMIN_EMAILS` | Preserve existing owner configuration |

No OpenAI key is copied into PrintWear. It obtains query/index embeddings through the signed Prompt to Print endpoint. No existing production credentials have been set, read into browser code or overwritten by this change.

## Metadata/search details and limits

Structured metadata covers title, description, primary/secondary categories, subjects, objects, styles, colours, audience/age where supported, occasions, moods, themes, keywords, Australian synonyms, garment suitability, personalisation possibilities and explicit uncertainties and visible image-quality flags. Software adds provenance, actual PNG metrics, source native DPI and receipt dates. Uncertain attributes and image-quality flags are not indexed as positive search facts. An engine type, nationality or brand is never inferred merely from a car's colour or silhouette.

The existing D1 catalogue is the source of truth. The same `catalogue_embeddings` and `search_buckets` index serves native and transferred artwork. Up to 500 indexed published products use exact cosine ranking. Larger catalogues use deterministic locality-sensitive candidate buckets plus keyword retrieval. This is approximate and needs a real-query recall/performance benchmark before 50,000-product scale; it is not a claim of production-scale relevance validation.

Voice input uses browser SpeechRecognition when available, with `en-AU`, explicit consent and a start button. Browser speech may process audio online. No audio is uploaded to either site's backend. Unsupported browsers, denied microphones and AI-service outages fall back to typed/keyword search. A genuine microphone session across supported devices remains a live acceptance item.

## Tests and honest verification boundaries

- PrintWear: `npm run typecheck`, `PTP_PROJECT_DIR=/path/to/ptp npm test` (29 passing tests including the real cross-project handler workflow), `npm run build`. Without the separate PTP checkout the cross-project test is skipped; all standalone tests still run.
- Prompt to Print: `npm run test:printwear`, standalone `node_modules/.bin/vinext build`.
- Targeted original Prompt to Print auth/export/workspace tests were compared against untouched commit `ffc56cb...`: 19 pass and the same 2 failures on both. Whole-project typecheck has the same 40 pre-existing diagnostics on both; no new diagnostics.
- Seven sender/service tests pass. The combined test exercises both real bridge handlers through private-gateway simulation, D1/R2, signing, retries, draft approval and shared-index search; only the external OpenAI responses/embeddings are mocked. Receiver tests use ephemeral real Miniflare D1/R2, PNG fixtures, resumable front/back transfers, exact production byte checks, approval, shared-index search, corrupt/large/oversized inputs, service rejection and repeat-query caching.
- Broader PTP regression comparison: modified source 247/258 pass, 11 fail; untouched baseline 245/258 pass, 13 fail. Every remaining failure also occurs on the baseline; no new failure names. These baseline tests include environment-dependent UI/module issues and existing assertions.
- Local browser checks verify the admin AI Catalogue tab, desktop/mobile layout, voice consent and the shared text/voice API using a synthetic browser speech event, plus customer exclusion from uploads.
- AI responses and embeddings in automated tests are fixtures. Real model visual accuracy, live credentials, private dispatch routing, genuine speech recognition and a live-site end-to-end transfer are **not yet verified**. No real API charges or production test listings were created.

## Expected cost

Each first import or native AI Catalogue analysis normally makes one vision metadata request and one small text embedding request. A new uncached search makes one embedding request; repeat queries cache for 24 hours. No image-generation or OpenAI transcription calls are added. Default metadata model is isolated to this new feature and does not change existing Prompt to Print generation models.

Planning allowance: US$0.01–0.03 per analysed design/pair (US$10–30 per 1,000), not a measured invoice or guaranteed price; model/image tokens, reasoning, retries and account pricing affect actual cost. Embedding published list price is US$0.02 per million input tokens, so 10,000 short 50-token queries are approximately US$0.01 in embedding input cost, before metadata calls and hosting. Confirm actual usage and the configured model in a small live pilot.

Sources checked 17 November 2026 Brisbane: https://developers.openai.com/api/docs/models/gpt-6-luna and https://developers.openai.com/api/docs/models/text-embedding-3-small . Existing `gpt-5-mini` usage elsewhere was not changed; its model page now marks it deprecated, so the new metadata feature uses a separately configurable current model.

## Activation order / rollback

1. Review both saved source versions, confirm the new-key names are unused, back up PrintWear D1 and verify recovery ownership. Do not change either Site's audience.
2. After explicit approval, add the fresh shared secret and destination/private-gateway settings; preserve all existing values. Configure and verify the new metadata model's access.
3. Deploy PrintWear's saved version first; Sites applies its additive migrations. It can receive signed imports but semantic query calls remain unavailable until the sender is updated.
4. Deploy Prompt to Print's saved version. No Prompt to Print schema change is required.
5. Configure/enable `PTP_EMBEDDING_URL` and the approved quota on PrintWear, deploying the same saved version with the new environment revision as required by Sites.
6. Use one specifically approved original test design. Admin click → receipt → byte check → metadata review → draft → explicit publication → natural-language/voice discovery. Confirm customer rejection and retries. Do not auto-create or publish a live test product.
7. If acceptance fails, return to the previous code versions and remove/disable only the newly added integration values. Preserve additive tables and production records; a code rollback is not a database rollback. Rotate the bridge secret if compromised. Any test-listing archival/removal requires the owner's instruction.

The master brief says: “Do not overwrite production credentials or modify live production data without explicit approval.” Deployment is held until approval because it applies live schema changes. Existing Sites are unchanged while this work is prepared.

## Admin image inbox and category approval

Open **Admin → Image inbox & AI** to drop PNG, JPEG, WebP or a front/back ZIP. This uses the existing automatic cleanup and print-size review; save the selected front/back as a draft with analysis enabled to generate metadata. The review opens automatically. Use **Select all AI suggestions** or individual category checkboxes, then **Approve categories & save**. The first selection is the primary category. The draft becomes visible in every approved category in the admin Catalogue, with thumbnail previews. **View in category** opens that folder. Final visual/ownership approval is still required for storefront visibility.

Multiple category memberships live in the existing artwork metadata record, so no database migration or duplicate image copies are needed. Only approved secondary categories affect public category filtering. Unsupported AI category names cannot become memberships. Saved category approval is invalidated by reanalysis or classification edits; stale category reviews receive HTTP 409. Category approval itself does not require another AI request. Original master files remain private, and checkout remains disabled.

## Verified Prompt to Print cleanup profiles

PrintWear cleanup v2 ports the verified `repairArtwork` physical-size rules from Prompt to Print source commit `51b2cf0301fc1d52f0ae1bb8f74ee508c79a8246`: both dimensions at most 60 mm use alpha below 96 and 1.25 mm detached-component tolerance; larger sizes use alpha below 160 and 0.8 mm tolerance. It retains the largest component, nearby punctuation/highlights, retained alpha and solid RGB; border blemishes use the existing identical helper. The worker retains its typed-array implementation and noisy-source guard above 2,000 components instead of the source's unbounded component scan. Optional edge-connected uniform backdrop removal remains an additional PrintWear operation. The admin report records profile, thresholds and removed pixel counts. Originals are immutable, and cleanup is always subject to visual review.

No named 40-operation pipeline was found in the inspected source. Colour knockout, whole-artwork halftoning, border smoothing, brush/eraser and generative revisions are separate deliberate Prompt to Print tools, not automatic repair steps; they are not silently applied during import.

## Enlarged inspection, full-path cleanup parity and custom categories

Click either original or cleaned preview in Artwork Prep for a full-screen inspector. It supports side-by-side and individual views, 100/200/400% actual-pixel zoom, linked scroll/pan, transparency/white/dark backgrounds, and red repair marks for pixels whose alpha changed. Escape closes the inspector. Repair marks and original canvas dimensions are retained only in the local prep workspace; they do not modify source masters.

The previous v2 test exercised only the repair core. Full-path investigation found two more PTP stages: `printableArtworkArea` trims fully transparent margins and `repairArtwork` decodes that working image through browser canvas. PrintWear now follows both stages before repair, then restores the untouched transparent outer frame for aligned before/after viewing. Explicit width and optional independent height drive the same physical tolerances. Extra uniform-background removal is now off by default because it is not part of PTP's repair function. Match both sites' physical sizes and optional effects before comparing. The very-noisy-source guard remains intentionally more conservative than PTP. A real Chromium test exercised PNG decode/crop/canvas/repair against PTP's actual functions and compared the repaired region pixel-for-pixel. Exact parity for the user's screenshot remains unverified without its original PNG and print dimensions.

Admin → Manage categories creates additional categories in the existing settings table (no migration). Names are unique ignoring case, 1–60 characters, up to 50 categories. They populate admin selection/approval and storefront browsing. AI image analysis still uses the established PTP vision schema; PrintWear then uses shared AI embeddings to recommend custom categories with cosine similarity at least 0.30. These are suggestions for human review, not validated categorisation. Embedding results use the existing daily budget and 24-hour cache. Changing categories invalidates saved analysis input hashes so the next analysis considers the updated list. Category creation never recategorises or publishes existing artwork.

## Simple automatic intake and production-source routine

Single uploads and named front/back pairs now automatically clean, save privately, analyse, then open a focused review containing the images, AI description, keywords and proposed categories. **Approve** confirms visual/ownership review, records the recommended categories and publishes only after the existing quality gates pass. **Delete** moves an unpublished draft to private trash, removes it from the normal admin catalogue and never exposes its files; protected originals remain stored. Ordinary customers cannot use either action. Detailed category, price, metadata and quality editing remains available under “Edit details”. Larger ambiguous batches still require explicit front/back selection. Automatic review can be disabled in Artwork Prep.

The worker now runs a verbatim copy of the actual PTP `repairArtwork` routine through real OffscreenCanvas interfaces. The adapter supplies the image/canvas interfaces without changing the routine's pixel logic. A source equality test guards against accidental drift. The clone of the core algorithm remains only as a fallback/reference utility and is not the worker's normal production repair. The separate browser parity test compares this entire working path with PTP's actual browser routine.

The uploaded Production and Search Rules v1.2 document is reference material: it also describes later storyboard/pilot approval and exact square production canvases. This website update does not generate those batches or automatically resize uploads to final production squares. Use the actual physical width/height of the working image; full-canvas production runs and web-upload runs with trimmed transparent margins are different preparations. Exact user-artwork parity still requires the source file and matching dimensions/effects.

## Owner-approved low-resolution artwork

Per the owner's instruction, effective DPI below 300 is a visible warning rather than a publication blocker. Saved per-side measurements remain unchanged. Quick Review displays each low-DPI side and print dimensions. Approval records `approved_low_dpi` and a distinct audit event; catalogue cards and product details retain a low-resolution notice. No pixel interpolation, artificial detail, or changed DPI measurements are introduced. Missing/empty artwork, invalid dimensions, transparency/clipping issues and unresolved non-resolution quality issues still block publication.

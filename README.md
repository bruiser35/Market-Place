# PrintWear

Independent, owner-operated digital DTF artwork store. Built with React/TypeScript, Vinext, Cloudflare Workers, D1 and R2, hosted through ChatGPT Sites.

## Current release

- Responsive storefront, categories, keyword search, product front/back gallery, bag, saved favourites and account-library shell.
- Owner-only admin studio, catalogue approval, original artwork prep, collection planning, configurable starting prices and saved creation guidelines.
- Automatic local PNG/JPEG/WebP/ZIP cleanup in a browser worker, original preservation, effective-DPI/transparency checks and 300 DPI PNG export.
- Separate immutable source, cleaned and watermarked-preview assets in R2; records and audit events in D1.
- PayPal, AI generation, advertising, semantic search, customer paid downloads and physical-print handoff are **not activated**. Checkout and paid download routes fail closed. Orders tables are preparation for the later payment implementation, not a working purchase flow.
- The production catalogue starts empty. Synthetic QA images exist only in local test storage.

## Run and check

Node 22.13+ (tested with Node 24). `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

Tests use ephemeral Miniflare D1/R2 resources. No production resources or AI/payment APIs are called.

For a local built preview, first build, then apply each new migration **once** using:

```sh
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_simple_sumo.sql
node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --ip 127.0.0.1 --port 4173 --persist-to .wrangler/state
```

Preview does not simulate customer sign-in. Automated local browser tests supply fixture identity headers; no local identity bypass is included in production code. Hosted identity headers are injected by ChatGPT Sites. `ADMIN_EMAILS` is configured in Sites runtime settings and must match the owner’s authenticated email. Site service tokens do not confer user identity.

## Publishing and source

The tracked `.openai/hosting.json` identifies **this PrintWear Site only** and declares `DB` and `FILES` bindings. Do not reuse Prompt to Print or Easy As Printing project IDs or resources.

GitHub `bruiser35/Market-Place` holds the development source. Sites also has its own managed Git remote. Publish by synchronizing the reviewed source to that managed remote, building the exact commit, packaging `.openai/hosting.json` and the built `dist/` output, then saving and publishing that version through the Sites tools. A push to GitHub alone does not deploy. Keep the current owner-private audience until public launch is explicitly requested.

The plugin workflow helpers were unavailable in this execution environment; this release uses the standalone Vinext build and direct Git synchronization permitted by the Sites source credential. The retained framework integration comes from the inspected existing Site; business runtime code and all Site identities are separate.

## Artwork contract

Sources remain unchanged. Cleanup is derived from Prompt to Print’s faint-alpha, physical-size speck and edge-blemish processing, with edge-connected uniform-background removal. It does not perform semantic background segmentation, AI upscaling or guarantee defect-free art. Dimensions are preserved; 300 DPI metadata never substitutes for sufficient visible pixels. Physical width is capped at 355 mm and length at 550 mm. Small text, colour/detail preservation and clipping require visual review and physical print tests before commercial sales.

Import limits: PNG/JPEG/WebP, ZIP subfolders, 20 images per workspace, 32 MB per image, 25 megapixels per image, 128 MB expanded ZIP total. Unsupported/unsafe archive entries are reported. Files are saved only when the administrator chooses **Save catalogue draft**. Browser prep state is temporary; saved files and records persist in R2/D1. Revised assets require a new draft to preserve immutable originals.

Auto checks must pass, both required sides and previews must exist, and the owner must explicitly confirm visual review and original rights before publication. Background removal should be disabled for intentional edge-connected backgrounds.

## Before public sales

Complete PayPal sandbox capture/webhook/refund/entitlement implementation, approved customer authentication, final licence/privacy/business/tax details, backup/restore ownership, rate-limit and operational monitoring, and print-sample validation. Add semantic search and generation services only after explicit provider and cost configuration. No automatic generation or advertising is scheduled.

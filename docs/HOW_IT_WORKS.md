# How RefGarden works

## Local and hosted

| Capability | Local app | Hosted source-search demo |
| --- | --- | --- |
| Query choice | Jev chooses from bounded options; exact samples may use prepared queries | Code chooses unused prompt/style phrases |
| Retrieval | Met API, NASA API, Cosmos public page | Same collector |
| Jev highlights | Up to one supplied reference per source per batch | None |
| Model input | Titles, descriptions and the creator brief | No model call in source search |
| Jev key | Local `.env`, then directly from the local backend to TypeSafe | No key accepted or configured |

The application runs locally; Jev inference runs at TypeSafe. The fast path sends no image bytes to Jev, performs no browser automation and makes no Astra call.

The optional OpenAI review in the spatial view calls the Responses API directly from the browser. Its key stays in tab memory and is cleared by refresh or the clear-keys control. This needs the visitor's own OpenAI API access and billing. A website still controls the JavaScript handling an entered key; local execution offers a different trust boundary.

The older `/legacy.html` view retains browser captures and Codex-directed experiments. Those need additional local setup: a compatible Codex CLI/login for reviews and Playwright Chromium (`npx playwright install chromium`) for captures. They are optional and separate from Explore. Provider/model access is account-dependent.

## The Jev requests

`src/creator.ts` exports the request builders. `buildSearchPlan` sends the styled brief, descriptions of the collections and one choice question per source. Each candidate answer is a phrase built by `src/search-options.ts`; Jev selects an offered option rather than writing a new string.

After collection, `buildShortlist` sends candidate IDs, titles, source names and descriptions truncated to 600 characters. Each source has a choice question asking for one useful reference or no match. Instructions explicitly say that the model sees no pixels and that source descriptions are data, not instructions.

`src/jev-client.ts` sends the JSON payload to `https://api.typesafe.ai/v1/systemone`. Responses are validated against the candidate IDs. It retries eligible failures once and preserves collected results if model selection fails.

## Retrieval and timing

`src/creator-collection.ts` starts sources concurrently. `src/creator-pool.ts` queues faster results and releases one reference per source together whenever their cumulative counts are equal. The first batch allows 34 Met, 33 NASA and 33 Cosmos references with a 12-second source collection deadline. Before the slowest source responds, a complete mixed group may not be available. Thumbnail downloads remain independent, so release time and visible-image time differ.

The continuous loop requests up to 30 new references per later batch. Its budgets prioritize sources behind in the run's cumulative totals; when already balanced, each gets ten. Results from a leading source wait while the others catch up. Cosmos has an additional limit: its cumulative count may not exceed half the combined Met and NASA count, keeping it at or below a third of the image collection. Archive videos do not count toward those shares. If an institutional source has no matches, the available institution can still contribute while excess Cosmos results are held back and omitted from the collected count. A notice explains the shortfall; the app does not invent equal source counts.

When a Met or NASA query yields too little, the collector can try up to two shorter prefixes of that query within the same 12-second collection deadline and source budget. These are code-selected fallbacks, recorded in source events; Jev chose the original phrase. A fresh run applies these limits; saved searches retain their recorded timing.

Duplicate filtering checks IDs and normalizes known image-size/format URL variants. Met records with the same detailed title, named artist and date count as one artwork, including catalog editions with separate IDs and image files. Generic titles such as “Dress” remain distinct. These identities persist across discovery rounds and hosted continuation requests. The gallery applies the same filter when reopening saved searches, so duplicate records do not take extra places or inflate displayed counts. This is metadata-based matching; visually similar images with unrelated URLs and metadata can still appear. Jev receives no pixels, and this filter adds no model calls or image downloads.

The loop retains exclusions, varies queries and advances NASA/Met pages when a query repeats. Three empty rounds end it. The spatial scene keeps every unique reference. The first 100 get priority, with up to eight thumbnail loads in flight. Later cards are inserted during idle time, up to four per callback, and their thumbnails wait until near the viewport. Once priority loads settle, at most two background thumbnails load at a time. A failed or 15-second timed-out thumbnail shows its source link and releases its loading slot.

New cards extend the spiral without moving or shrinking earlier cards. Offscreen animations pause, and background insertion yields during drag/zoom or while the tab is hidden. Starting another search clears queued loads and ignores stale callbacks. Stop ends discovery; already-collected images can finish loading. The timer distinguishes collected references from loaded thumbnails, while source counts describe all collected references. Saved searches use the same loading policy and retain their recorded timings. Long searches still grow the reference records and DOM; this is progressive loading, not a fixed-memory virtualized renderer.

The first-image timestamp records a loaded thumbnail entering the viewport. The session timer includes source retrieval, model calls, retries and inter-batch waits. Saved searches retain their recorded timings. Browser/CDN caching can accelerate repeated image display. None of these timings is a standalone model latency benchmark.

## Code map

| File | Responsibility |
| --- | --- |
| `server.ts` | Loopback server and local credential connection |
| `src/creator.ts` | Jev query choice and metadata highlights |
| `src/discovery.ts` | Continuous local discovery |
| `src/sources.ts` | Source requests, metadata and attribution |
| `src/creator-collection.ts` | Concurrent source orchestration |
| `src/creator-pool.ts` | Quotas and deduplication |
| `src/spatial.ts` | Prompt, controls, run records and saved work |
| `src/orbit-scene.ts` | Spatial layout, image arrivals and navigation |
| `src/public-research.ts` | Keyword-only hosted orchestration |
| `src/hosted-api.ts` | Hosted routes and credential rejection |
| `src/astra-api.ts` | Optional browser-to-OpenAI review |

## Data on disk

The local `.env` contains the Jev key. Connection writes use restricted file permissions. `.local/references.json` retains a bounded metadata cache for pins and legacy runs. The browser stores prompts, pinned references and saved searches under the existing `jev-curator-*` storage names so previously saved work remains readable.

Fresh Explore actions make source requests. Restoring a saved search restores its recorded results. Provider keys are excluded from search exports and browser persistence.

## Vercel

`npm run build:hosted` produces the source-search frontend. `api/` routes use `src/hosted-api.ts`; the local server is excluded. The retired credential proxy endpoints reject requests, and the research route accepts only search fields. A deployment does not inherit a local `.env` key or Codex login.

This configuration has no accounts, payment ledger or enforceable per-user paid quotas. Running a paid Jev service requires a separately designed backend with an application-owned key, authentication and budget enforcement. Never convert the current hosted routes into a visitor-key relay.

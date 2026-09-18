# Contributing to RefGarden

Start with an issue that describes the creator's task, the current result and the behavior you want. Screenshots help for visual changes. Use synthetic prompts and redact private information.

For a small fix, open a pull request with a clear before/after description. Discuss new sources, providers or changes to key handling before implementing them. See [the roadmap](ROADMAP.md) for current priorities.

## Local checks

Use Node.js 22 or newer. Run `npm ci`, then `npm run check`. Start the built app with `npm start`. The pinned Bun binary lives in `node_modules`; global Bun is optional. CI runs on Linux and macOS.

Keep tests meaningful: verify cancellation, deduplication, source failure, model-output validation and credential boundaries. Model tests should mock provider requests. Never make a contributor's test suite spend real API credits.

## Preserve the experience

- Prompts remain editable and style choices preserve the original text.
- Incoming references stream progressively; Stop cancels active work.
- Every reference retains its source and available attribution.
- Model output is validated against supplied candidates.
- Saved runs identify recorded timing; fresh runs measure their own work.
- Reduced-motion preferences remain respected.

Keep provider keys out of browser bundles, logs, run exports and fixtures. Local keys stay with the person running the app. The hosted source-search backend does not accept visitor model credentials.

Source descriptions are untrusted data. New adapters need documented access permission, source policies and attribution behavior. Model input must say whether it contains metadata, pixels or both. Do not present metadata matching as visual understanding.

Contributions are submitted under the repository's MIT license. Include attribution and compatible licensing for any code or media you add.

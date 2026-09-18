![An orbital garden of blue botanical prints, lunar studies and archival paper. Concept artwork for RefGarden.](docs/assets/refgarden-cover.png)

# RefGarden

A space to find your next visual.

Explore references from **The Met, NASA and Cosmos** in a moving, three-dimensional gallery. Describe a direction, choose your styles, and follow the images as they arrive. Keep what catches your eye, with a link back to its source.

[Run locally](#run-locally) · [How Jev works](docs/HOW_IT_WORKS.md) · [Roadmap](ROADMAP.md) · [Contribute](CONTRIBUTING.md)

**Local Explore uses Jev.** It chooses search phrases and highlights references from their titles and descriptions. It does not see image pixels. The [public source-search demo](https://jev-curator.vercel.app) shows the gallery and retrieval flow without calling Jev.

## Start with a direction

> A botanical observatory on the Moon. Cobalt cyanotypes, silver spacecraft details, lunar landscapes and delicate scientific drawings.

Or try Bauhaus ballet costumes, glowing ocean life, or a quiet editorial about an eclipse. Your prompt stays editable. Cinematic, Typography, Chrome, Botanical, Analog, Minimal, Surreal and Scientific styles can be combined.

- Images arrive progressively in a spatial gallery. Drag to orbit; scroll to zoom.
- Explore starts with up to 100 references, then discovers more until you press Stop or the sources stop returning new results.
- The first 100 images have loading priority. Later results expand the gallery, loading two thumbnails at a time near the viewport. Earlier images stay in place.
- The timer separates collected references from loaded thumbnails. Source counts cover the full collection.
- Fresh results arrive in mixed groups. Faster sources wait for slower ones, and later batches prioritize collections behind in the total. If a source runs out of matches, a notice explains the gap.
- Keep references, revisit saved searches and export the search record.
- Inspect the source query, model selections and timing behind a run.

## Run locally

Install [Node.js](https://nodejs.org/) 22 or newer, then:

```sh
git clone https://github.com/AlbionaHoti/refgarden.git
cd refgarden
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4318**. Expand **Connections**, paste your [TypeSafe API key](https://console.typesafe.ai/) and choose **Connect Jev**. Then enter a prompt and press **Explore**.

The project installs its own pinned Bun runtime. A global Bun installation is optional. Connecting the key makes a small verification request and saves it in the local, ignored `.env` file. Jev runs through TypeSafe's API and uses your provider allowance. The maintainer's server is not involved in local Jev requests.

For environment-based setup, copy `.env.example` to `.env` and fill in `TYPESAFE_AI_API_KEY` before starting. If port 4318 is occupied, set `PORT` in that file. Stop the server with Ctrl+C; rebuild and restart after editing source code.

## What the model does

```text
Your prompt + styles
        ↓
Jev chooses a search phrase for each collection
        ↓
Source requests run together → images enter the gallery
        ↓
Jev reads the returned metadata → up to one highlight per source
        ↓
Next batch, until Stop
```

Search phrases come from a bounded set extracted from the brief and style presets. Exact sample prompts can use prepared queries for their first batch. Jev can choose that no reference fits.

Images appear before the final model selection. The displayed image count is the number retrieved, not the number visually reviewed by AI. The timer includes retrieval, model requests and waiting; it is not an isolated Jev benchmark. Network conditions, source availability and thumbnail caches affect it.

The fast Explore path uses source APIs and public page responses. It does not operate a browser or require Astra. Optional OpenAI metadata curation and older browser/Codex experiments are documented in [How it works](docs/HOW_IT_WORKS.md).

## Sources and rights

| Source | How references arrive | Reuse |
| --- | --- | --- |
| The Met | Open Access collection API | The adapter requests public-domain objects with images. Check the object's record. |
| NASA | Image and Video Library API | Check the item's credits and NASA's media-use rules, including third-party material. |
| Cosmos | Public search-page response | Experimental adapter. Cosmos restricts automated access; use requires appropriate permission. |

The software license covers the application code. Referenced images, descriptions and third-party marks retain their own rights. A search result is a reference, not a blanket license to reuse an image. See [source policies and attribution](NOTICE.md).

## Development

```sh
npm run check
```

This runs the tests, TypeScript checks and production build. Tests use synthetic fixtures and mocked model calls; they require no API keys. For frontend development, run `npm start` in one terminal and `npm run dev` in another. The Vite server proxies API calls to the local backend on port 4318.

The Vercel configuration builds the source-search demo. It does not deploy the local Jev backend or a shared provider key. See [deployment boundaries](docs/HOW_IT_WORKS.md#local-and-hosted).

## Where this can grow

RefGarden starts with reference discovery. The next work is better evidence of relevance, permitted source integrations, and an opt-in way to explore your own image folders. Hosted accounts and paid convenience remain a possible later direction. These are plans, not shipped features; [the roadmap](ROADMAP.md) records the order and acceptance criteria.

Built by [AlbionaHoti](https://github.com/AlbionaHoti). Inspired by [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast) and [Jev Trader](https://github.com/jarrodwatts/jev-trader). Independent project; no affiliation with TypeSafe, NASA, The Met or Cosmos.

[MIT licensed](LICENSE). README cover generated for this project; [art direction and provenance](docs/ART.md).

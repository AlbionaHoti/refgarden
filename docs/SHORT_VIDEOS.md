# Short video references

Select **Short videos** below the prompt. Keep **Images** checked to mix both formats, or uncheck it for a video search. Try `Vintage coffee commercials` or `Vintage toy commercials`, then press **Explore**. Stop ends discovery and keeps the cards available for playback.

The first video source is Internet Archive's Prelinger Archives: historical advertising, animation and short films. These are archival references, not a feed of current social posts. Every card links to its original item and has a duration badge. Click a card for a larger player with sound controls; previews start muted.

Search uses the [Internet Archive metadata API](https://archive.org/developers/metadata.html). The adapter checks MP4 file metadata and accepts clips with a recorded duration greater than zero and at most 180 seconds. Missing durations, larger files over 80 MB, restricted items and unsupported media are skipped. Within an item, it prefers the smallest eligible MP4 for previews. Catalog metadata can be imperfect; playback still depends on the archive and browser.

Local Jev chooses a search phrase from bounded options extracted from the prompt. It receives the brief, selected styles and prior video queries. It receives no video frames or audio and does not assess edits, captions, sound hooks or opening shots. File duration filtering is code. The hosted source-search path chooses phrases without a model and accepts no provider keys.

Each batch examines up to 36 items with at most three metadata requests in flight and adds up to 12 unique clips. It has a 20-second retrieval deadline. Explore continues with more queries/pages until Stop or three empty batches. Images keep their existing three-source balance; archive video counts are separate.

Cards keep the first-100 thumbnail priority. At most eight visible video previews play concurrently, with visible clips taking turns every 12 seconds. Offscreen players release their media; hidden tabs and the detail dialog pause background previews. The loaded count describes thumbnails, not fully buffered videos. No videos are downloaded into the repository or served through a media proxy.

Saved searches retain references and measured search times. Reopening one replays its results. Press Explore for a fresh source request. Archive inclusion alone does not grant reuse rights; check the linked item's terms before using footage in a published edit.

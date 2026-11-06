# Close Circle

A responsive shared friend-group app for Sarosh, Hassan, Anthony, Jamser, and Aris. GitHub Pages hosts the app; Supabase stores the shared posts, hangout polls, votes, ideas, photos, and videos.

## Cloud setup

1. Run `supabase-setup.sql` in the Supabase SQL Editor.
2. Put the project's URL and **publishable** API key in `config.js`.
3. Commit and push `config.js` with the rest of the site so GitHub Pages can connect to the cloud project.

The browser uses Supabase Realtime for updates and Supabase Storage for media. It does not save post content or media in browser storage or the project folder. The publishable key is intended for browser apps; access is controlled by the database policies in the SQL setup file.

## Media and storage

The media upload pipeline uses the Strategy pattern: still images are resized to a maximum 1920-pixel edge and converted to WebP when that reduces size; GIF animation is kept intact, while videos upload unchanged. Photos render in a consistent 4:3 frame without cropping; videos use a 16:9 player frame and fit inside it. MP4 and WebM videos are limited to 50 MB per file.

The repository adapter owns cloud upload and cleanup operations (Repository pattern). If a multi-file upload fails partway through, the already uploaded objects are removed. When the provider reports full storage, the app shows a message to remove old media in Supabase Storage. This app does not automatically create replacement Supabase projects: Free has a fixed included quota and currently permits two active projects, so cycling projects is neither an unlimited nor reliable storage plan. Keep one project as the source of truth; remove media you no longer need, or move to a storage plan/provider with more capacity if the circle grows. Free projects can pause after seven days of inactivity.

See [Supabase plan details](https://supabase.com/pricing), [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits), and [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

## Project structure

- `app.js` — app behavior and cloud repository adapter
- `config.js` — Supabase project URL, publishable key, and media bucket
- `supabase-setup.sql` — shared-state table, merge function, access policies, Realtime publication, and media bucket
- `index.html`, `styles.css` — app shell and visual design

# Close Circle

A responsive shared friend-group app for Sarosh, Hassan, Anthony, Jamser, and Aris. GitHub Pages hosts the app; Supabase stores the shared posts, hangout polls, votes, ideas, photos, and videos.

## Cloud setup

1. Run `supabase-setup.sql` in the Supabase SQL Editor.
2. Put the project's URL and **publishable** API key in `config.js`.
3. Commit and push `config.js` with the rest of the site so GitHub Pages can connect to the cloud project.

The browser uses Supabase Realtime for updates and Supabase Storage for media. It does not save post content or media in browser storage or the project folder. The publishable key is intended for browser apps; access is controlled by the database policies in the SQL setup file.

The free Supabase plan includes 500 MB of database, 1 GB of file storage, and 2 million Realtime messages. Free projects pause after one week of inactivity and resume when reopened. [Current plan details](https://supabase.com/pricing).

## Project structure

- `app.js` — app behavior and cloud repository adapter
- `config.js` — Supabase project URL, publishable key, and media bucket
- `supabase-setup.sql` — shared-state table, merge function, access policies, Realtime publication, and media bucket
- `index.html`, `styles.css` — app shell and visual design

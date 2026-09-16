# UC Schedule API

Cloudflare Worker + D1 is the trusted backend for the existing GitHub Pages UI.
GitHub Pages remains the public frontend; passwords, sessions, roles, mutations,
Discord webhooks, audit records, and backups live server-side.

## Required bindings and secrets

- D1 binding: `DB`
- `ALLOWED_ORIGIN=https://tophik2345.github.io`
- Worker secrets: `DISCORD_WEBHOOK`, optional `DISCORD_REPORT_WEBHOOK`,
  optional `DISCORD_ROLE_ID`, and one-time `BOOTSTRAP_TOKEN`

## First deployment

1. Create the D1 database and put its ID in `wrangler.toml`.
2. Apply `schema.sql` to the remote database.
3. Configure the secrets in the protected Cloudflare settings.
4. Deploy the Worker.
5. POST the current `users.json`, `schedule.json`, and `povyshenie.json` once to
   `/api/bootstrap` with `Authorization: Bearer <BOOTSTRAP_TOKEN>`.
6. Delete `BOOTSTRAP_TOKEN` after a successful import.

The bootstrap endpoint is also permanently disabled in D1 after its first
successful import.

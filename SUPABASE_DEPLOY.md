# Supabase deploy — MVP-1 runbook

Audience: Tim. About 15 minutes end-to-end once the CLI is installed.

## What's in this folder

These files belong in the `addie-breakroom-games` GitHub repo. The local
`breakroom-games/` folder is a staging area — once everything's working,
commit them to the repo so `breakroom-leaderboard.js` is served from
GitHub Pages.

```
breakroom-games/
├── supabase/
│   ├── config.toml                        ← CLI project binding
│   ├── migrations/
│   │   └── 0001_init.sql                  ← schema + seed + RPC + RLS
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts                    ← origin allowlist
│       │   └── moderation.ts              ← Anthropic classifier
│       ├── register-player/index.ts
│       └── submit-score/index.ts
└── breakroom-leaderboard.js               ← drop-in browser lib
```

## Step 1 — Run the SQL

Supabase dashboard → SQL Editor → paste the entire contents of
`supabase/migrations/0001_init.sql` → Run.

Confirm in Table Editor that you see:

| table           | rows |
|-----------------|------|
| games           | 4    |
| players         | 0    |
| scores          | 0    |
| weekly_archive  | 0    |
| username_audit  | 0    |

## Step 2 — Verify the games seed

Open the `games` table. The seed values for `scoring_direction` are
best-guesses for everything except Sudoku:

| id              | scoring_direction  | note               |
|-----------------|--------------------|--------------------|
| sudoku          | lower_is_better    | ✓ verified (time)  |
| bed_locator     | higher_is_better   | best guess         |
| hospital_escape | higher_is_better   | best guess         |
| unseen_case     | higher_is_better   | best guess         |

If any are wrong, fix in the SQL Editor:

```sql
update public.games set scoring_direction = 'lower_is_better' where id = 'unseen_case';
```

## Step 3 — Add the Anthropic API key

Supabase dashboard → Project settings → Edge Functions → Secrets → Add:

| Name                  | Value                        |
|-----------------------|------------------------------|
| `ANTHROPIC_API_KEY`   | your Anthropic key           |

Confirm the key has access to `claude-haiku-4-5`.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
into Edge Function runtimes — you don't add those manually.

## Step 4 — Deploy the Edge Functions

Install the CLI if you don't have it yet:
<https://supabase.com/docs/guides/cli/getting-started>

From inside this `breakroom-games/` folder:

```
supabase login
supabase link --project-ref sxpyphlqnpjncxtckivm
supabase functions deploy register-player --no-verify-jwt
supabase functions deploy submit-score --no-verify-jwt
```

`--no-verify-jwt` is correct because we manage player auth ourselves
via `player_token`. The publishable `apikey` header on every request is
still required.

## Step 5 — Smoke test

Replace `<paste>` with the `player_token` from the first response.

```bash
# Register
curl -s -X POST https://sxpyphlqnpjncxtckivm.supabase.co/functions/v1/register-player \
  -H "Content-Type: application/json" \
  -H "apikey: sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn" \
  -H "Authorization: Bearer sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn" \
  -d '{"username":"smoke_test_tim"}' | jq

# Submit a score
curl -s -X POST https://sxpyphlqnpjncxtckivm.supabase.co/functions/v1/submit-score \
  -H "Content-Type: application/json" \
  -H "apikey: sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn" \
  -H "Authorization: Bearer sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn" \
  -d '{"player_token":"<paste>","game_id":"sudoku","score":120,"meta":{"difficulty":"medium"}}' | jq

# Read the leaderboard (no auth needed for the RPC)
curl -s -X POST https://sxpyphlqnpjncxtckivm.supabase.co/rest/v1/rpc/get_current_leaderboard \
  -H "Content-Type: application/json" \
  -H "apikey: sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn" \
  -d '{"p_game_id":"sudoku","p_limit":10}' | jq
```

Both Edge Function calls should return `{"ok": true, ...}`. The leaderboard
call should show `smoke_test_tim` at rank 1.

Also try a deliberately rude username to confirm the classifier works —
should return `{"ok": false, "decision": "rejected"}`.

When you're done testing, delete the smoke-test row from `players` to
keep the table clean.

## Step 6 — Commit to GitHub

Once everything passes, push to `addie-breakroom-games`:

```
git add supabase/ breakroom-leaderboard.js SUPABASE_DEPLOY.md
git commit -m "MVP-1 leaderboard backend + drop-in client lib"
git push
```

GitHub Pages will pick up `breakroom-leaderboard.js` automatically at
`https://timothypoore-blip.github.io/addie-breakroom-games/breakroom-leaderboard.js`.

## Step 7 — Stop and tell Claude

Don't wire any games yet. Once you've eyeballed the JS lib and the
Edge Function code and confirmed the smoke test passes, kick the next
session and I'll wire Sudoku as the first integration (MVP-2 start).

// submit-score
// POST { player_token, game_id, score, meta? } → { ok, score_id, week_starts_at, player_status }
//
// Pipeline:
//   1. Validate inputs (token is a UUID, game_id is reasonable, score is finite)
//   2. Resolve player_token → player row (must exist)
//   3. Resolve game_id → games row (must exist and be active)
//   4. Compute week_starts_at server-side (UTC Monday)
//   5. Insert score, update player.last_active_at, return result

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json, preflightResponse } from "../_shared/cors.ts";

interface SubmitBody {
  player_token?: string;
  game_id?: string;
  score?: number;
  meta?: Record<string, unknown>;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(s);
}

function utcMondayDateString(now: Date = new Date()): string {
  // getUTCDay: 0=Sun, 1=Mon, ... 6=Sat. We want most-recent Monday.
  const day = now.getUTCDay();
  const offset = (day + 6) % 7; // days since Monday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const pre = preflightResponse(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, 405, { error: "method_not_allowed" });
  }

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "invalid_json" });
  }

  const playerToken = body.player_token ?? "";
  const gameId = body.game_id ?? "";
  const score = body.score;
  const meta = (body.meta ?? {}) as Record<string, unknown>;

  if (!isUuid(playerToken)) {
    return json(req, 400, { ok: false, error: "bad_player_token" });
  }
  if (!gameId || gameId.length > 64) {
    return json(req, 400, { ok: false, error: "bad_game_id" });
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return json(req, 400, { ok: false, error: "bad_score" });
  }
  // Sanity bounds — adjust if a game legitimately needs more headroom.
  if (score < 0 || score > 1e9) {
    return json(req, 400, { ok: false, error: "bad_score_range" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: player } = await supabase
    .from("players")
    .select("id, status")
    .eq("player_token", playerToken)
    .maybeSingle();

  if (!player) {
    return json(req, 401, { ok: false, error: "unknown_player" });
  }

  const { data: game } = await supabase
    .from("games")
    .select("id, is_active")
    .eq("id", gameId)
    .maybeSingle();

  if (!game) {
    return json(req, 404, { ok: false, error: "unknown_game" });
  }
  if (!game.is_active) {
    return json(req, 410, { ok: false, error: "game_inactive" });
  }

  const weekStartsAt = utcMondayDateString();

  const { data: insertedScore, error: insertErr } = await supabase
    .from("scores")
    .insert({
      player_id: player.id,
      game_id: gameId,
      score,
      week_starts_at: weekStartsAt,
      client_meta: meta,
    })
    .select("id")
    .single();

  if (insertErr || !insertedScore) {
    return json(req, 500, {
      ok: false,
      error: "db_insert_failed",
      detail: insertErr?.message,
    });
  }

  // Best-effort last-seen touch
  await supabase
    .from("players")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", player.id);

  return json(req, 200, {
    ok: true,
    score_id: insertedScore.id,
    week_starts_at: weekStartsAt,
    player_status: player.status,
    note: player.status !== "approved"
      ? "Score recorded. You won't show on the public board until your username is approved."
      : null,
  });
});

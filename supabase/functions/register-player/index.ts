// register-player
// POST { username, email? } → { ok, player_token, status, note? }
//
// Pipeline:
//   1. Validate shape (length, charset, optional email format)
//   2. Hard denylist (cheap, fail-fast on obvious cases)
//   3. Anthropic moderation classifier (the real check)
//   4. Uniqueness check (case-insensitive)
//   5. Insert player + audit row, return long-lived player_token

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json, preflightResponse } from "../_shared/cors.ts";
import { moderateUsername } from "../_shared/moderation.ts";

const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
// Unicode-aware: letters, numbers, space, _ . -
const USERNAME_RE = /^[\p{L}\p{N} _.\-]+$/u;

// Tiny representative hard-deny list. Anthropic catches a much wider net;
// this just saves an API call on the most obvious cases. Replace with a
// proper word list in a follow-up.
const HARD_DENY = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigg",
  "fag",
  "retard",
];

interface RegisterBody {
  username?: string;
  email?: string | null;
}

function normalizeUsername(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function quickDenyCheck(username: string): string | null {
  const lower = username.toLowerCase().replace(/[^a-z]/g, "");
  for (const term of HARD_DENY) {
    if (lower.includes(term)) return term;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const pre = preflightResponse(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, 405, { error: "method_not_allowed" });
  }

  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "invalid_json" });
  }

  // ── Shape validation
  const username = normalizeUsername(body.username ?? "");
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return json(req, 400, {
      ok: false,
      error: "username_length",
      reason: `Pick something ${USERNAME_MIN}–${USERNAME_MAX} characters long.`,
    });
  }
  if (!USERNAME_RE.test(username)) {
    return json(req, 400, {
      ok: false,
      error: "username_charset",
      reason: "Letters, numbers, spaces, and . _ - only.",
    });
  }

  const email = body.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(req, 400, {
      ok: false,
      error: "email_invalid",
      reason: "That email doesn't look right.",
    });
  }

  // ── Decision pipeline
  let decision: "approved" | "flagged" | "rejected" = "approved";
  let reason = "";
  let classifierRaw: unknown = null;

  const hit = quickDenyCheck(username);
  if (hit) {
    decision = "rejected";
    reason = `denylist:${hit}`;
  } else {
    try {
      const result = await moderateUsername(username);
      decision = result.decision;
      reason = result.reason;
      classifierRaw = result.raw;
    } catch (e) {
      // Fail closed — don't auto-approve when the classifier is down
      decision = "flagged";
      reason = `classifier_error:${String(e).slice(0, 200)}`;
    }
  }

  if (decision === "rejected") {
    return json(req, 200, {
      ok: false,
      decision,
      reason: "That name isn't allowed. Try another.",
    });
  }

  // ── DB inserts (service role bypasses RLS)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const usernameLower = username.toLowerCase();

  const { data: existing } = await supabase
    .from("players")
    .select("id")
    .eq("username_lower", usernameLower)
    .maybeSingle();

  if (existing) {
    return json(req, 200, {
      ok: false,
      decision: "rejected",
      reason: "That name's already taken — try another.",
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("players")
    .insert({
      username,
      email,
      status: decision,
      flag_reason: decision === "flagged" ? reason : null,
    })
    .select("id, player_token, username, status")
    .single();

  if (insertError || !inserted) {
    return json(req, 500, {
      ok: false,
      error: "db_insert_failed",
      detail: insertError?.message,
    });
  }

  // Audit (best-effort; don't fail registration if audit insert fails)
  await supabase.from("username_audit").insert({
    player_id: inserted.id,
    username,
    decision,
    classifier_response: classifierRaw as object | null,
    reviewed_by: "auto",
  });

  return json(req, 200, {
    ok: true,
    decision,
    player_token: inserted.player_token,
    username: inserted.username,
    note: decision === "flagged"
      ? "Your name is pending a quick review. Your scores still count — they'll appear on the public board once approved."
      : null,
  });
});

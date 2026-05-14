// Username moderation via Anthropic claude-haiku-4-5.
//
// Decision contract:
//   "approved" — safe, no issues, score goes on the public leaderboard.
//   "flagged"  — borderline; player can play but won't appear publicly until
//                Tim manually reviews in Supabase Studio (players table → set
//                status='approved' or 'rejected').
//   "rejected" — clearly unsafe; registration is refused.
//
// If the classifier fails (network, parse error, etc.) we FAIL CLOSED to
// "flagged" rather than risking a false-approve.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a moderation classifier for usernames on a wellness app for healthcare professionals (case managers, social workers, nurses). The audience is competent adults; mild humor and irreverence are welcome and on-brand. What is NOT welcome: slurs, sexual content, doxxing (real-looking full names, addresses, phone numbers, SSNs), harassment, impersonation of a brand or real public figure, content that targets a protected group.

Classify the input username into EXACTLY ONE of:
- "approved" — safe, no issues at all.
- "flagged" — borderline; merits a human eye (mild profanity, ambiguous slang, contains what looks like a personal name).
- "rejected" — clearly unsafe.

Respond with valid JSON only, exact shape:
{"decision":"approved"|"flagged"|"rejected","reason":"<short string>"}

No prose. No markdown. JSON only.`;

export interface ModerationResult {
  decision: "approved" | "flagged" | "rejected";
  reason: string;
  raw: unknown;
}

export async function moderateUsername(
  username: string,
): Promise<ModerationResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set in Edge Function secrets");
  }

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Username to classify: ${JSON.stringify(username)}`,
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const rawText: string = (data?.content?.[0]?.text ?? "").trim();

  // Models occasionally wrap JSON in ```json ... ``` despite the prompt.
  // Strip code fences and slice down to the first '{' .. last '}' window.
  let text = rawText;
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }

  let parsed: { decision?: string; reason?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      decision: "flagged",
      reason: "classifier_returned_non_json",
      raw: data,
    };
  }

  const d = parsed.decision;
  if (d !== "approved" && d !== "flagged" && d !== "rejected") {
    return {
      decision: "flagged",
      reason: "classifier_invalid_decision",
      raw: data,
    };
  }

  return { decision: d, reason: parsed.reason ?? "", raw: data };
}

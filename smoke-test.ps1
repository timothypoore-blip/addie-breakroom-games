# Break Room Games -- leaderboard backend smoke test (v2)
# Uses PowerShell's native Invoke-RestMethod everywhere to dodge the
# curl.exe / PowerShell argument-quoting bug with JSON bodies.
#
# Run from PowerShell in the breakroom-games folder:
#   powershell -ExecutionPolicy Bypass -File .\smoke-test.ps1 | Tee-Object -FilePath smoke-test-output.txt

$ErrorActionPreference = "Continue"
$URL = "https://sxpyphlqnpjncxtckivm.supabase.co"
$KEY = "sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn"

$H = @{
  apikey        = $KEY
  Authorization = "Bearer $KEY"
}

function Section($n, $title) {
  Write-Host ""
  Write-Host "=== $n. $title ===" -ForegroundColor Cyan
}

# Helper: POST JSON, print result. Returns the parsed object (or $null).
# Catches non-2xx so we can still see the error body inline.
function PostJson($uri, $payload) {
  $body = $payload | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $H -ContentType "application/json" -Body $body
    if ($r -is [string]) { Write-Host $r } else { Write-Host ($r | ConvertTo-Json -Compress -Depth 8) }
    return $r
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $code = $resp.StatusCode.value__
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $errBody = $reader.ReadToEnd()
      $reader.Close()
      Write-Host "HTTP $code -- $errBody" -ForegroundColor Yellow
      try { return $errBody | ConvertFrom-Json } catch { return $null }
    }
    Write-Host "ERROR: $_" -ForegroundColor Red
    return $null
  }
}

# Helper: GET, print result. Catches non-2xx the same way.
function GetCheck($uri) {
  try {
    $r = Invoke-RestMethod -Method Get -Uri $uri -Headers $H
    if ($r -is [string]) { Write-Host $r } else { Write-Host ($r | ConvertTo-Json -Compress -Depth 8) }
    return $r
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $code = $resp.StatusCode.value__
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $errBody = $reader.ReadToEnd()
      $reader.Close()
      Write-Host "HTTP $code -- $errBody" -ForegroundColor Yellow
      try { return $errBody | ConvertFrom-Json } catch { return $null }
    }
    Write-Host "ERROR: $_" -ForegroundColor Red
    return $null
  }
}

# 1. Schema sanity: games table seeded
Section 1 "games table (expect 4 rows)"
GetCheck "$URL/rest/v1/games?select=id,scoring_direction,is_active,hub_order&order=hub_order.asc" | Out-Null

# 2. RPC exists and returns empty (no scores yet)
Section 2 "leaderboard RPC (expect [] -- empty array)"
PostJson "$URL/rest/v1/rpc/get_current_leaderboard" @{ p_game_id = "sudoku"; p_limit = 10 } | Out-Null

# 3. register-player reachable (GET should return HTTP 405)
Section 3 "register-player reachable (GET; expect HTTP 405 method_not_allowed)"
GetCheck "$URL/functions/v1/register-player" | Out-Null

# 4. submit-score reachable
Section 4 "submit-score reachable (GET; expect HTTP 405 method_not_allowed)"
GetCheck "$URL/functions/v1/submit-score" | Out-Null

# 5. End-to-end: register a real test user.
# Username intentionally has no personal-name token, so the classifier's
# "contains what looks like a personal name" rule won't false-flag it.
Section 5 "register addieSmokeTest (expect ok:true, decision:approved, a player_token)"
$reg = PostJson "$URL/functions/v1/register-player" @{ username = "addieSmokeTest" }

$token = $null
if ($reg -and $reg.ok -and $reg.player_token) {
  $token = $reg.player_token
  Write-Host ""
  Write-Host "-> captured player_token: $token" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "-> registration did not return a token. Stopping end-to-end test." -ForegroundColor Yellow
  Write-Host "  (If 'username already taken', delete the smoke_test_tim row in Supabase Studio and re-run.)"
}

# 6. Submit a score with the captured token
if ($token) {
  Section 6 "submit a score of 120 for sudoku (expect ok:true)"
  PostJson "$URL/functions/v1/submit-score" @{
    player_token = $token
    game_id      = "sudoku"
    score        = 120
    meta         = @{ difficulty = "medium" }
  } | Out-Null

  # 7. Read the leaderboard -- should now show smoke_test_tim at rank 1
  Section 7 "read sudoku leaderboard (expect 1 row: smoke_test_tim at rank 1, score 120)"
  PostJson "$URL/rest/v1/rpc/get_current_leaderboard" @{ p_game_id = "sudoku"; p_limit = 10 } | Out-Null
}

# 8a. Moderation via HARD DENYLIST (fast path; never hits Anthropic).
# Contains "shit", which is on the hardcoded denylist -- should return immediately.
Section "8a" "denylist rejects shitlord_69 (expect ok:false, decision:rejected, no Anthropic call)"
PostJson "$URL/functions/v1/register-player" @{ username = "shitlord_69" } | Out-Null

# 8b. Moderation via Anthropic classifier (LLM path).
# A clearly inappropriate-for-healthcare username that doesn't trip the
# denylist, so the LLM has to make the call.
Section "8b" "Anthropic rejects patient_killer_99 (expect ok:false, decision:rejected)"
PostJson "$URL/functions/v1/register-player" @{ username = "patient_killer_99" } | Out-Null

Write-Host ""
Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "Paste this output back to Claude. Then in Supabase Studio, delete the addieSmokeTest row from players if registration succeeded."
Write-Host ""
Read-Host "Press Enter to close"

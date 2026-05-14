/*!
 * Addie Break Room Leaderboard — drop-in client library (MVP-1)
 * Hosted on GitHub Pages; one <script src> per score-keeping game.
 *
 * Public API:
 *   BreakroomLeaderboard.submit({ gameId, score, meta? })
 *     → Promise<{ posted, scoreId?, weekStartsAt?, playerStatus?, note?, reason? }>
 *   BreakroomLeaderboard.getUsername() → string ('' if not registered)
 *   BreakroomLeaderboard.clearIdentity() → void  (for testing / sign-out)
 *
 * MVP-2 will add renderTop10 and renderHubWidget.
 */
(function (global) {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────── */
  var SUPABASE_URL = 'https://sxpyphlqnpjncxtckivm.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_r25bJMDW37MwfozuHou5Jw_wf12bgGn';
  var LS_TOKEN_KEY = 'addiePlayerToken';
  var LS_USERNAME_KEY = 'addiePlayerUsername';

  /* ── Storage helpers ────────────────────────────────────────── */
  function getToken() {
    try { return localStorage.getItem(LS_TOKEN_KEY); } catch (_) { return null; }
  }
  function setToken(token, username) {
    try {
      localStorage.setItem(LS_TOKEN_KEY, token);
      if (username) localStorage.setItem(LS_USERNAME_KEY, username);
    } catch (_) { /* iframes with disabled storage — ignore */ }
  }
  function clearToken() {
    try {
      localStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_USERNAME_KEY);
    } catch (_) { /* ignore */ }
  }
  function getStoredUsername() {
    try { return localStorage.getItem(LS_USERNAME_KEY) || ''; } catch (_) { return ''; }
  }

  /* ── Fetch helper ───────────────────────────────────────────── */
  function callEdge(path, payload) {
    return fetch(SUPABASE_URL + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    });
  }

  /* ── Registration modal ─────────────────────────────────────── */
  function showRegistrationModal() {
    return new Promise(function (resolve, reject) {
      var overlay = document.createElement('div');
      overlay.setAttribute('data-addie-modal', '1');
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'background:rgba(8,24,41,0.7)', 'backdrop-filter:blur(6px)',
        '-webkit-backdrop-filter:blur(6px)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-family:Poppins,system-ui,sans-serif', 'padding:20px'
      ].join(';');

      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:18px;padding:24px;max-width:380px;width:100%;',
        'box-shadow:0 18px 40px rgba(0,0,0,.25);">',
          '<div style="font-size:.7rem;font-weight:700;color:#6fa030;letter-spacing:.08em;',
                      'text-transform:uppercase;margin-bottom:6px;">Save your spot</div>',
          '<h3 style="margin:0 0 6px;font-size:1.15rem;font-weight:800;color:#081829;">',
            'Pick a leaderboard name',
          '</h3>',
          '<p style="margin:0 0 16px;font-size:.82rem;color:#475569;line-height:1.4;">',
            'One name across every Break Room game. Email is optional — only used to recover ',
            'your name on another device.',
          '</p>',
          '<label style="display:block;font-size:.7rem;font-weight:700;color:#475569;margin-bottom:4px;">',
            'Display name',
          '</label>',
          '<input id="addie-uname" type="text" maxlength="24" autocomplete="off" ',
                 'style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;',
                        'font-family:inherit;font-size:.95rem;color:#081829;outline:none;margin-bottom:12px;box-sizing:border-box;"/>',
          '<label style="display:block;font-size:.7rem;font-weight:700;color:#475569;margin-bottom:4px;">',
            'Email <span style="font-weight:500;color:#94a3b8;">(optional)</span>',
          '</label>',
          '<input id="addie-email" type="email" autocomplete="email" ',
                 'style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;',
                        'font-family:inherit;font-size:.95rem;color:#081829;outline:none;margin-bottom:8px;box-sizing:border-box;"/>',
          '<p id="addie-err" style="margin:0 0 10px;font-size:.75rem;color:#dc2626;min-height:1em;line-height:1.3;"></p>',
          '<div style="display:flex;gap:8px;">',
            '<button id="addie-cancel" type="button" ',
                    'style="flex:1;padding:11px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;',
                           'border-radius:10px;font-family:inherit;font-weight:600;cursor:pointer;font-size:.9rem;">',
              'Skip',
            '</button>',
            '<button id="addie-submit" type="button" ',
                    'style="flex:2;padding:11px;border:none;background:linear-gradient(135deg,#081829,#185793);',
                           'color:#fff;border-radius:10px;font-family:inherit;font-weight:700;cursor:pointer;font-size:.9rem;">',
              'Save & post score',
            '</button>',
          '</div>',
          '<p style="margin:10px 0 0;font-size:.65rem;color:#94a3b8;line-height:1.3;">',
            'Your name will appear on the public weekly leaderboard. PEP may feature top scorers in posts.',
          '</p>',
        '</div>'
      ].join('');

      document.body.appendChild(overlay);
      var unameInput = overlay.querySelector('#addie-uname');
      var emailInput = overlay.querySelector('#addie-email');
      var errEl = overlay.querySelector('#addie-err');
      var submitBtn = overlay.querySelector('#addie-submit');
      var cancelBtn = overlay.querySelector('#addie-cancel');

      var preset = getStoredUsername();
      if (preset) unameInput.value = preset;
      setTimeout(function () { unameInput.focus(); }, 50);

      function done(payload) {
        overlay.remove();
        resolve(payload);
      }
      function cancelled() {
        overlay.remove();
        reject(new Error('cancelled'));
      }

      cancelBtn.addEventListener('click', cancelled);

      submitBtn.addEventListener('click', async function () {
        errEl.textContent = '';
        var username = unameInput.value.trim();
        var email = emailInput.value.trim();
        if (username.length < 2) { errEl.textContent = 'At least 2 characters please.'; return; }

        submitBtn.disabled = true;
        var origLabel = submitBtn.textContent;
        submitBtn.textContent = 'Checking…';
        try {
          var resp = await callEdge('/functions/v1/register-player', {
            username: username,
            email: email || null
          });
          var body = resp.body || {};
          if (!resp.ok || !body.ok) {
            errEl.textContent = body.reason || body.message || 'Try a different name.';
            submitBtn.disabled = false;
            submitBtn.textContent = origLabel;
            return;
          }
          setToken(body.player_token, body.username);
          done({ token: body.player_token, username: body.username, status: body.decision, note: body.note });
        } catch (_) {
          errEl.textContent = 'Network issue — try again.';
          submitBtn.disabled = false;
          submitBtn.textContent = origLabel;
        }
      });

      unameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
      });
      emailInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
      });
    });
  }

  /* ── Public API ─────────────────────────────────────────────── */

  async function submit(opts) {
    if (!opts || !opts.gameId || typeof opts.score !== 'number') {
      throw new Error('BreakroomLeaderboard.submit needs { gameId, score, meta? }');
    }

    var token = getToken();
    if (!token) {
      try {
        var reg = await showRegistrationModal();
        token = reg.token;
      } catch (_) {
        return { posted: false, reason: 'user_skipped' };
      }
    }

    var resp = await callEdge('/functions/v1/submit-score', {
      player_token: token,
      game_id: opts.gameId,
      score: opts.score,
      meta: opts.meta || {}
    });
    var body = resp.body || {};

    if (!resp.ok || !body.ok) {
      // Token doesn't resolve anymore (player wiped, etc.) — re-prompt.
      if (body && body.error === 'unknown_player') {
        clearToken();
      }
      return { posted: false, reason: (body && body.error) || 'submit_failed' };
    }

    return {
      posted: true,
      scoreId: body.score_id,
      weekStartsAt: body.week_starts_at,
      playerStatus: body.player_status,
      note: body.note || null
    };
  }

  function getUsername() {
    return getStoredUsername();
  }

  function clearIdentity() {
    clearToken();
  }

  global.BreakroomLeaderboard = {
    submit: submit,
    getUsername: getUsername,
    clearIdentity: clearIdentity,
    // Exposed for hand-testing only; not part of the supported API
    _showRegistrationModal: showRegistrationModal
  };
})(window);

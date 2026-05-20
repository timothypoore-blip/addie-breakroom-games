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

  /* ── Hub leaderboard widget ────────────────────────────────── */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtScore(score, game) {
    // Sudoku scores are seconds — render as m:ss.
    if (game && game.id === 'sudoku') {
      var n = Math.max(0, Math.floor(score));
      var m = Math.floor(n / 60), s = n % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    return String(score);
  }

  function injectHubStyles() {
    if (document.getElementById('addie-lb-styles')) return;
    var st = document.createElement('style');
    st.id = 'addie-lb-styles';
    st.textContent = [
      '.addie-lb-card{background:#fff;border-radius:18px;padding:22px;',
        'box-shadow:0 8px 32px rgba(8,24,41,0.08);border:1px solid #e2e8f0;',
        'font-family:Poppins,system-ui,sans-serif;max-width:520px;margin:0 auto;}',
      '.addie-lb-header{text-align:center;margin-bottom:14px;}',
      '.addie-lb-eyebrow{font-size:.68rem;font-weight:700;color:#6fa030;',
        'letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;}',
      '.addie-lb-title{margin:0;font-size:1.2rem;font-weight:800;color:#081829;}',
      '.addie-lb-tabs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:14px;}',
      '.addie-lb-tab{padding:6px 14px;border-radius:100px;border:1.5px solid #e2e8f0;',
        'background:#fff;font-family:inherit;font-size:.78rem;font-weight:600;',
        'color:#475569;cursor:pointer;transition:all .15s;}',
      '.addie-lb-tab:hover:not(.active){border-color:#185793;color:#185793;}',
      '.addie-lb-tab.active{background:linear-gradient(135deg,#081829,#185793);',
        'border-color:#081829;color:#fff;}',
      '.addie-lb-list{margin:0 0 10px;}',
      '.addie-lb-row{display:grid;grid-template-columns:36px 1fr auto;gap:10px;',
        'padding:9px 12px;border-bottom:1px solid #f1f5f9;align-items:center;}',
      '.addie-lb-row:last-child{border-bottom:none;}',
      '.addie-lb-row.you{background:rgba(139,197,63,.08);border-radius:8px;}',
      '.addie-lb-rank{font-weight:800;color:#475569;font-size:.88rem;}',
      '.addie-lb-rank.gold{color:#6fa030;}',
      '.addie-lb-rank.silver{color:#94a3b8;}',
      '.addie-lb-rank.bronze{color:#b87333;}',
      '.addie-lb-uname{font-weight:600;color:#081829;font-size:.9rem;',
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.addie-lb-uname-you{font-size:.62rem;font-weight:700;color:#6fa030;',
        'margin-left:6px;letter-spacing:.05em;text-transform:uppercase;}',
      '.addie-lb-score{font-weight:800;color:#185793;font-size:.95rem;',
        'font-variant-numeric:tabular-nums;}',
      '.addie-lb-empty{text-align:center;padding:22px 16px;color:#94a3b8;font-size:.82rem;}',
      '.addie-lb-loading{text-align:center;padding:22px 16px;color:#94a3b8;font-size:.82rem;}',
      '.addie-lb-footer{text-align:center;font-size:.62rem;color:#94a3b8;margin-top:6px;}'
    ].join('');
    document.head.appendChild(st);
  }

  function fetchJson(path, options) {
    options = options || {};
    return fetch(SUPABASE_URL + path, Object.assign({
      headers: { apikey: SUPABASE_ANON_KEY, authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    }, options)).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function fetchActiveGames() {
    return fetchJson(
      '/rest/v1/games?select=id,display_name,scoring_direction,hub_order&is_active=eq.true&order=hub_order.asc'
    );
  }

  function fetchTopN(gameId, limit) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/get_current_leaderboard', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ p_game_id: gameId, p_limit: limit })
    }).then(function (r) { return r.ok ? r.json() : []; });
  }

  function rankClass(rank) {
    if (rank === 1) return 'addie-lb-rank gold';
    if (rank === 2) return 'addie-lb-rank silver';
    if (rank === 3) return 'addie-lb-rank bronze';
    return 'addie-lb-rank';
  }

  function renderCard(card, entries, activeIdx) {
    var active = entries[activeIdx];
    var myUsername = getStoredUsername();
    var out = [];

    out.push('<div class="addie-lb-header">');
    out.push('<div class="addie-lb-eyebrow">This week’s top players</div>');
    out.push('<h3 class="addie-lb-title">🏆 Break Room Leaderboard</h3>');
    out.push('</div>');

    out.push('<div class="addie-lb-tabs">');
    entries.forEach(function (e, i) {
      var cls = (i === activeIdx) ? 'addie-lb-tab active' : 'addie-lb-tab';
      out.push('<button type="button" class="' + cls + '" data-tab-idx="' + i + '">' +
        escapeHtml(e.game.display_name) + '</button>');
    });
    out.push('</div>');

    out.push('<div class="addie-lb-list">');
    if (!active.rows || active.rows.length === 0) {
      out.push('<div class="addie-lb-empty">No scores yet this week — be the first to play ' +
        escapeHtml(active.game.display_name) + '!</div>');
    } else {
      active.rows.forEach(function (r) {
        var isMe = myUsername && r.username && myUsername.toLowerCase() === r.username.toLowerCase();
        out.push('<div class="addie-lb-row' + (isMe ? ' you' : '') + '">');
        out.push('<span class="' + rankClass(r.rank) + '">#' + r.rank + '</span>');
        out.push('<span class="addie-lb-uname">' + escapeHtml(r.username) +
          (isMe ? '<span class="addie-lb-uname-you">you</span>' : '') + '</span>');
        out.push('<span class="addie-lb-score">' + escapeHtml(fmtScore(r.score, active.game)) + '</span>');
        out.push('</div>');
      });
    }
    out.push('</div>');

    out.push('<div class="addie-lb-footer">Resets Mondays at midnight UTC.</div>');

    card.innerHTML = out.join('');

    Array.prototype.forEach.call(card.querySelectorAll('.addie-lb-tab'), function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-tab-idx'), 10);
        if (!isNaN(idx)) renderCard(card, entries, idx);
      });
    });
  }

  function renderHubWidget(elementId, opts) {
    opts = opts || {};
    var limit = opts.limit || 5;
    var rootEl = (typeof elementId === 'string')
      ? document.getElementById(elementId)
      : elementId;
    if (!rootEl) {
      console.warn('BreakroomLeaderboard.renderHubWidget: target not found:', elementId);
      return;
    }

    injectHubStyles();

    rootEl.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'addie-lb-card';
    card.innerHTML = '<div class="addie-lb-loading">Loading leaderboards…</div>';
    rootEl.appendChild(card);

    fetchActiveGames().then(function (games) {
      if (!games || !games.length) {
        card.innerHTML = '<div class="addie-lb-empty">No games configured yet.</div>';
        return;
      }
      return Promise.all(games.map(function (g) {
        return fetchTopN(g.id, limit).then(function (rows) { return { game: g, rows: rows }; });
      })).then(function (entries) {
        renderCard(card, entries, 0);
      });
    }).catch(function (e) {
      console.warn('renderHubWidget error:', e);
      card.innerHTML = '<div class="addie-lb-empty">Couldn’t load leaderboards right now — try refreshing.</div>';
    });
  }

  /* ── Public API ─────────────────────────────────────────────── */

  global.BreakroomLeaderboard = {
    submit: submit,
    getUsername: getUsername,
    clearIdentity: clearIdentity,
    renderHubWidget: renderHubWidget,
    // Exposed for hand-testing only; not part of the supported API
    _showRegistrationModal: showRegistrationModal
  };
})(window);

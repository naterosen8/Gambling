import {
  MARKET_NAMES,
  SPORTS,
  formatPoint,
  formatPrice,
  isValidPrice,
  matchStake,
  otherSide,
  sideLabel,
} from './markets.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const slip = document.getElementById('slip');
const state = { user: null, demo: false };
let pollTimer;

// ---- Helpers ----

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const credits = (n) => Number(n).toLocaleString();
const when = (iso) =>
  new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function api(path, body) {
  const res = await fetch(
    path,
    body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

async function refreshMe() {
  const data = await api('/api/auth');
  state.user = data.user;
  state.demo = data.demo;
  renderNav();
}

function renderNav() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0];
  const link = (href, text, name) => `<a href="${href}" class="${route === name ? 'active' : ''}">${text}</a>`;
  nav.innerHTML = state.user
    ? link('#/lines', 'Lines', 'lines') +
      link('#/board', 'Open board', 'board') +
      link('#/', 'My bets', '') +
      `<span class="balance" title="Your credits">${credits(state.user.balance)}</span>` +
      '<a href="#" id="logout">Log out</a>'
    : '';
  nav.querySelector('#logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/auth', { action: 'logout' });
    state.user = null;
    location.hash = '#/';
    render();
  });
}

function errorBox(err) {
  return `<div class="banner bad">${esc(err.message)}</div>`;
}

function demoBanner() {
  return state.demo
    ? '<div class="banner warn">Showing sample lines. Add an <code>ODDS_API_KEY</code> to load real lines and settle game bets automatically.</div>'
    : '';
}

// ---- Router ----

async function render() {
  clearInterval(pollTimer);
  if (slip.open) slip.close();
  renderNav();
  const [route, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (route === 'bet') return await betView(params[0]);
    if (!state.user) return authView(app);
    if (route === 'lines') return await linesView(params[0] || SPORTS[0].key);
    if (route === 'game') return await gameView(params[0], params[1]);
    if (route === 'board') return await boardView();
    return await myBetsView();
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ---- Log in / sign up ----

function authView(container, intro = '') {
  let mode = 'signup';
  const draw = () => {
    container.innerHTML = `
      <div class="auth card">
        ${intro || '<h1>Bet your friends, not the house</h1><p class="muted">Pick a line, set the stakes, send the link. Both stakes sit in escrow until the game ends, and the winner takes the pot. You start with 1,000 free credits.</p>'}
        <div class="tabs">
          <a href="#" data-mode="signup" class="${mode === 'signup' ? 'active' : ''}">Sign up</a>
          <a href="#" data-mode="login" class="${mode === 'login' ? 'active' : ''}">Log in</a>
        </div>
        <form>
          <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required></div>
          <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required></div>
          <button class="btn primary block">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
          <p class="error"></p>
        </form>
      </div>`;
    container.querySelectorAll('[data-mode]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        mode = a.dataset.mode;
        draw();
      })
    );
    const form = container.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const data = await api('/api/auth', {
          action: mode,
          username: form.username.value,
          password: form.password.value,
        });
        state.user = data.user;
        render();
      } catch (err) {
        form.querySelector('.error').textContent = err.message;
        button.disabled = false;
      }
    });
  };
  draw();
}

// ---- Lines ----

function sportTabs(active) {
  return `<div class="tabs">${SPORTS.map(
    (s) => `<a href="#/lines/${s.key}" class="${s.key === active ? 'active' : ''}">${s.title}</a>`
  ).join('')}</div>`;
}

// Buttons on the lines pages refer to picks by index, so we keep them here.
let picks = [];

function pickButton(game, market, outcome, text) {
  if (!outcome) return '<button class="odd" disabled>—</button>';
  picks.push({ game, market, ...outcome });
  return `<button class="odd" data-pick="${picks.length - 1}">${text}<small>${formatPrice(outcome.price)}</small></button>`;
}

function gameCard(game, { propsLink = true } = {}) {
  const m = game.markets;
  const find = (market, selection) => m[market]?.find((o) => o.selection === selection);
  const spread = (team) => {
    const o = find('spreads', team);
    return pickButton(game, 'spreads', o, o ? formatPoint(o.point) : '');
  };
  const ml = (team) => pickButton(game, 'h2h', find('h2h', team), 'ML');
  const total = (side) => {
    const o = find('totals', side);
    return pickButton(game, 'totals', o, o ? `${side[0]} ${o.point}` : '');
  };
  return `
    <div class="card">
      <div class="game-head">
        <span>${esc(when(game.commence_time))}</span>
        ${propsLink ? `<a href="#/game/${esc(game.sport_key)}/${esc(game.id)}">Player props ›</a>` : ''}
      </div>
      <div class="lines-grid">
        <span></span><span class="col-head">Spread</span><span class="col-head">Moneyline</span><span class="col-head">Total</span>
        <span class="team">${esc(game.away_team)}</span>${spread(game.away_team)}${ml(game.away_team)}${total('Over')}
        <span class="team">${esc(game.home_team)} <span class="muted small">(home)</span></span>${spread(game.home_team)}${ml(game.home_team)}${total('Under')}
      </div>
    </div>`;
}

function bindPicks() {
  app.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => openSlip(picks[b.dataset.pick])));
}

async function linesView(sportKey) {
  const sport = SPORTS.find((s) => s.key === sportKey) || SPORTS[0];
  app.innerHTML = `${sportTabs(sport.key)}<p class="muted">Loading ${sport.title} lines…</p>`;
  const { games } = await api(`/api/lines?sport=${sport.key}`);
  picks = [];
  app.innerHTML = `
    ${sportTabs(sport.key)}
    ${demoBanner()}
    <p class="muted small">Tap a line to make a bet out of it. You can change the line and odds before you send it.</p>
    ${games.length ? games.map((g) => gameCard(g)).join('') : `<div class="empty">No upcoming ${sport.title} games with lines right now.</div>`}`;
  bindPicks();
}

async function gameView(sportKey, eventId) {
  app.innerHTML = '<p class="muted">Loading props…</p>';
  const { game, props } = await api(`/api/lines?sport=${encodeURIComponent(sportKey)}&event=${encodeURIComponent(eventId)}`);
  picks = [];
  const groups = new Map();
  for (const prop of props) {
    if (!groups.has(prop.market)) groups.set(prop.market, []);
    groups.get(prop.market).push(prop);
  }
  const propButton = (prop, selection) => {
    const o = prop.outcomes.find((x) => x.selection === selection);
    const text = o?.point == null ? selection : `${selection[0]} ${o.point}`;
    return pickButton(game, prop.market, o && { ...o, player: prop.player }, text);
  };
  const rows = [...groups].map(([market, list]) => {
    const [a, b] = list.some((p) => p.outcomes.some((o) => o.selection === 'Yes')) ? ['Yes', 'No'] : ['Over', 'Under'];
    return `
      <div class="props-group">
        <h3>${esc(MARKET_NAMES[market] || market)}</h3>
        ${list.map((p) => `<div class="prop-row"><span class="team">${esc(p.player)}</span>${propButton(p, a)}${propButton(p, b)}</div>`).join('')}
      </div>`;
  });
  app.innerHTML = `
    <p><a href="#/lines/${esc(sportKey)}">‹ All games</a></p>
    <h1>${esc(game.away_team)} @ ${esc(game.home_team)}</h1>
    ${demoBanner()}
    ${gameCard(game, { propsLink: false })}
    <h2 class="section">Player props</h2>
    ${rows.length ? `<div class="card">${rows.join('')}</div>` : '<div class="empty">No player props posted for this game yet. They usually show up a day or two before kickoff.</div>'}`;
  bindPicks();
}

// ---- Bet slip ----

function openSlip(pick) {
  const { game } = pick;
  const hasPoint = pick.point != null;
  let takerEdited = false;
  slip.innerHTML = `
    <form method="dialog">
      <div class="row"><h2 id="slip-title"></h2><button class="btn" value="cancel" formnovalidate aria-label="Close">✕</button></div>
      <p class="muted small">${esc(game.away_team)} @ ${esc(game.home_team)} · ${esc(when(game.commence_time))}</p>
      <div class="fields">
        ${hasPoint ? `<div class="field"><label for="point">Line</label><input id="point" type="number" step="0.5" value="${pick.point}" required></div>` : ''}
        <div class="field"><label for="price">Odds (American)</label><input id="price" type="number" step="1" value="${pick.price}" required></div>
        <div class="field"><label for="stake">You put up</label><input id="stake" type="number" min="1" step="1" value="100" required></div>
        <div class="field"><label for="taker">Your opponent puts up</label><input id="taker" type="number" min="1" step="1" required></div>
      </div>
      <div class="slip-summary" id="summary"></div>
      <label>Who can take the other side?</label>
      <label class="choice"><input type="radio" name="visibility" value="private" checked> <span>Only people I send the invite link to</span></label>
      <label class="choice"><input type="radio" name="visibility" value="open"> <span>Anyone. Also post it on the open board</span></label>
      <div class="field"><label for="note">Note (optional)</label><input id="note" maxlength="200" placeholder="Loser buys wings"></div>
      <button class="btn primary block" value="default" id="place">Lock in my stake</button>
      <p class="error" id="slip-error"></p>
    </form>`;

  const $ = (id) => slip.querySelector(`#${id}`);
  const current = () => {
    const point = hasPoint ? Number($('point').value) : null;
    const bet = { market: pick.market, selection: pick.selection, point, player: pick.player, home_team: game.home_team, away_team: game.away_team };
    return { bet, point, price: Number($('price').value), stake: Number($('stake').value), taker: Number($('taker').value) };
  };
  const update = () => {
    const { bet, price, stake } = current();
    const priceOk = isValidPrice(price);
    if (!takerEdited && priceOk && stake >= 1) $('taker').value = matchStake(Math.round(stake), price);
    $('slip-title').textContent = sideLabel(bet, bet);
    const takerNow = Number($('taker').value);
    $('summary').innerHTML = priceOk
      ? `You risk <strong>${credits(stake || 0)}</strong> to win <strong>${credits(takerNow || 0)}</strong>.<br>
         Your opponent gets <strong>${esc(sideLabel(bet, otherSide(bet)))}</strong>.<br>
         Winner takes the pot of <strong>${credits((stake || 0) + (takerNow || 0))}</strong>.`
      : 'Odds must be +100 or higher, or -100 or lower.';
    $('place').textContent = `Lock in ${credits(stake || 0)} credits`;
  };
  slip.querySelectorAll('input').forEach((input) => input.addEventListener('input', update));
  $('taker').addEventListener('input', () => (takerEdited = true));
  update();

  slip.querySelector('form').addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const { point, price, stake, taker } = current();
    $('place').disabled = true;
    try {
      const { id } = await api('/api/bets', {
        action: 'create',
        sport: game.sport_key,
        event_id: game.id,
        market: pick.market,
        selection: pick.selection,
        player: pick.player,
        point,
        price,
        stake,
        taker_stake: taker,
        visibility: slip.querySelector('[name=visibility]:checked').value,
        note: $('note').value,
      });
      slip.close();
      await refreshMe();
      location.hash = `#/bet/${id}`;
    } catch (err) {
      $('slip-error').textContent = err.message;
      $('place').disabled = false;
    }
  });
  slip.showModal();
}

// ---- Bet lists ----

function statusBadge(b) {
  if (b.status === 'open') return '<span class="badge waiting">Waiting for opponent</span>';
  if (b.status === 'matched') return b.offer ? '<span class="badge waiting">Cash-out offer</span>' : '<span class="badge live">Locked in</span>';
  if (b.status === 'cancelled') return `<span class="badge">${b.result === 'expired' ? 'Expired, refunded' : 'Cancelled'}</span>`;
  if (b.result === 'push') return '<span class="badge">Push</span>';
  if (!b.role) return `<span class="badge">${b.result === 'cashout' ? 'Cashed out' : 'Settled'}</span>`;
  const me = b[b.role];
  const net = me.payout - me.stake;
  const label = b.result === 'cashout' ? 'Cashed out' : net > 0 ? 'Won' : 'Lost';
  return `<span class="badge ${net > 0 ? 'won' : net < 0 ? 'lost' : ''}">${label} ${net > 0 ? '+' : ''}${credits(net)}</span>`;
}

function betCard(b, { asTaker = false } = {}) {
  const role = asTaker ? 'taker' : b.role || 'creator';
  const me = b[role];
  const them = b[role === 'creator' ? 'taker' : 'creator'];
  const opponent = them.username ? `vs ${esc(them.username)}` : 'No opponent yet';
  return `
    <a class="card" href="#/bet/${esc(b.id)}">
      <div class="row muted small"><span>${esc(b.sport_title)} · ${esc(b.away_team)} @ ${esc(b.home_team)}</span><span>${esc(when(b.commence_time))}</span></div>
      <div class="pick">${esc(me.side)}</div>
      <div class="row small">
        <span class="muted">${asTaker ? `Posted by ${esc(b.creator.username)}` : opponent} · risk ${credits(me.stake)} to win ${credits(them.stake)}</span>
        ${asTaker ? '<span class="badge live">Take it ›</span>' : statusBadge(b)}
      </div>
    </a>`;
}

async function myBetsView() {
  app.innerHTML = '<p class="muted">Loading your bets…</p>';
  const { user, bets } = await api('/api/bets?view=mine');
  state.user = user;
  renderNav();
  const active = bets.filter((b) => b.status === 'matched');
  const waiting = bets.filter((b) => b.status === 'open');
  const done = bets.filter((b) => b.status === 'settled' || b.status === 'cancelled');
  const list = (items, empty) => (items.length ? items.map((b) => betCard(b)).join('') : `<div class="empty">${empty}</div>`);
  app.innerHTML = `
    <div class="row"><h1>My bets</h1><a class="btn primary" href="#/lines">Make a bet</a></div>
    <h2 class="section">Locked in</h2>
    ${list(active, 'No active bets.')}
    <h2 class="section">Waiting for an opponent</h2>
    ${list(waiting, 'Nothing waiting. Pick a line and send a friend the link.')}
    <h2 class="section">Finished</h2>
    ${list(done, 'No finished bets yet.')}`;
}

async function boardView() {
  app.innerHTML = '<p class="muted">Loading the board…</p>';
  const { bets } = await api('/api/bets?view=board');
  const theirs = bets.filter((b) => b.role !== 'creator');
  const mine = bets.filter((b) => b.role === 'creator');
  app.innerHTML = `
    <h1>Open board</h1>
    <p class="muted">Bets anyone can take. Taking one locks your stake in escrow against theirs.</p>
    ${theirs.length ? theirs.map((b) => betCard(b, { asTaker: true })).join('') : '<div class="empty">No open bets right now. Post one from the Lines page.</div>'}
    ${mine.length ? `<h2 class="section">Your posted bets</h2>${mine.map((b) => betCard(b)).join('')}` : ''}`;
}

// ---- One bet ----

async function betView(id) {
  let last = '';
  const load = async () => {
    const { bet } = await api(`/api/bets?id=${encodeURIComponent(id)}`);
    const json = JSON.stringify(bet);
    if (json === last) return;
    last = json;
    drawBet(bet);
  };
  app.innerHTML = '<p class="muted">Loading bet…</p>';
  await load();
  // Keep the page current while waiting on the other person.
  pollTimer = setInterval(() => {
    if (!document.hidden && !app.contains(document.activeElement?.closest('input'))) load().catch(() => {});
  }, 15000);
}

function drawBet(b) {
  const isParty = Boolean(b.role);
  const me = isParty ? b[b.role] : null;
  const otherRole = b.role === 'creator' ? 'taker' : 'creator';
  const them = isParty ? b[otherRole] : null;
  const side = (who, role) => `
    <div class="side">
      <div class="who">${who.username ? esc(who.username) : 'Open seat'}${b.role === role ? ' (you)' : ''}</div>
      <div class="what">${esc(who.side)}</div>
      <div class="small muted">Puts up ${credits(who.stake)}${who.payout != null ? ` · paid ${credits(who.payout)}` : ''}</div>
    </div>`;

  app.innerHTML = `
    <div class="card">
      <div class="row muted small"><span>${esc(b.sport_title)} · ${esc(b.market_name)}</span><span>${statusBadge(b)}</span></div>
      <h1 style="margin-top:8px">${esc(b.away_team)} @ ${esc(b.home_team)}</h1>
      <p class="muted small">${esc(when(b.commence_time))} · posted at ${esc(formatPrice(b.price))}</p>
      <div class="sides">${side(b.creator, 'creator')}${side(b.taker, 'taker')}</div>
      <p class="pot">Pot <strong>${credits(b.pot)}</strong></p>
      ${b.note ? `<p class="small">“${esc(b.note)}”</p>` : ''}
      <div id="actions"></div>
    </div>`;
  const actions = app.querySelector('#actions');

  const act = async (body, button) => {
    if (button) button.disabled = true;
    const error = actions.querySelector('.error');
    try {
      const { bet } = await api('/api/bets', { id: b.id, ...body });
      await refreshMe();
      drawBet(bet);
    } catch (err) {
      if (error) error.textContent = err.message;
      if (button) button.disabled = false;
    }
  };

  if (b.status === 'open') {
    if (b.role === 'creator') {
      const link = `${location.origin}/#/bet/${b.id}`;
      actions.innerHTML = `
        <div class="panel stack">
          <h3>Send this to your friend</h3>
          <div class="invite"><input readonly value="${esc(link)}"><button class="btn primary" id="copy">Copy</button></div>
          <p class="muted small">Whoever opens the link first and accepts gets the other side. ${b.visibility === 'open' ? "It's also listed on the open board." : ''} If nobody takes it before the game starts, you get your stake back.</p>
          <button class="btn danger" id="cancel">Cancel and refund my ${credits(b.creator.stake)}</button>
          <p class="error"></p>
        </div>`;
      actions.querySelector('#copy').addEventListener('click', async (e) => {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) {
          navigator.share({ title: 'Bet me', text: `${b.taker.side}? Take the bet:`, url: link }).catch(() => {});
          return;
        }
        await navigator.clipboard.writeText(link);
        e.target.textContent = 'Copied';
      });
      actions.querySelector('#cancel').addEventListener('click', (e) => act({ action: 'cancel' }, e.target));
    } else if (!state.user) {
      authView(actions, `<h2>${esc(b.creator.username)} wants to bet you</h2><p class="muted">You'd get <strong>${esc(b.taker.side)}</strong>: put up ${credits(b.taker.stake)} to win ${credits(b.creator.stake)}. Sign up free (1,000 credits) to take it.</p>`);
    } else {
      const short = state.user.balance < b.taker.stake;
      actions.innerHTML = `
        <div class="panel">
          <button class="btn primary block" id="accept" ${short ? 'disabled' : ''}>Take ${esc(b.taker.side)}: put up ${credits(b.taker.stake)} to win ${credits(b.creator.stake)}</button>
          <p class="error">${short ? `You need ${credits(b.taker.stake)} credits and have ${credits(state.user.balance)}.` : ''}</p>
        </div>`;
      actions.querySelector('#accept').addEventListener('click', (e) => act({ action: 'accept' }, e.target));
    }
    return;
  }

  if (b.status === 'cancelled') {
    actions.innerHTML = `<div class="panel muted">${b.result === 'expired' ? 'Nobody took this bet before the game started, so the stake was refunded.' : 'This bet was cancelled and the stake was refunded.'}</div>`;
    return;
  }

  if (b.status === 'settled') {
    const how = {
      cashout: 'Both sides agreed to cash out early.',
      push: "It's a push. Both stakes were returned.",
      creator: `${esc(b.creator.username)} won.`,
      taker: `${esc(b.taker.username)} won.`,
    }[b.result];
    actions.innerHTML = `<div class="panel"><p>${how}</p><p class="muted small">${esc(b.creator.username)} got ${credits(b.creator.payout)} · ${esc(b.taker.username)} got ${credits(b.taker.payout)}</p></div>`;
    return;
  }

  // Matched: locked in between two people.
  if (!isParty) {
    actions.innerHTML = `<div class="panel muted">This bet is locked in between ${esc(b.creator.username)} and ${esc(b.taker.username)}.</div>`;
    return;
  }

  const started = new Date(b.commence_time) <= new Date();
  const whoWon = (report) =>
    !report ? 'nothing yet' : report === 'push' ? 'push' : report === b.role ? 'you won' : `${esc(them.username)} won`;
  let offerHtml;
  if (!b.offer) {
    offerHtml = `
      <h3>Cash out early</h3>
      <p class="muted small">Offer to end the bet now and split the pot. If ${esc(them.username)} accepts, it pays out right away.</p>
      <div class="fields">
        <div class="field"><label for="mine">I take</label><input id="mine" type="number" min="0" max="${b.pot}" step="1" value="${me.stake}"></div>
        <div class="field"><label>${esc(them.username)} gets</label><input id="theirs" readonly value="${b.pot - me.stake}"></div>
      </div>
      <button class="btn" id="offer">Send offer</button>`;
  } else if (b.offer.by === b.role) {
    offerHtml = `
      <h3>Your cash-out offer</h3>
      <p>You take <strong>${credits(b.offer[`${b.role}_amount`])}</strong>, ${esc(them.username)} gets <strong>${credits(b.offer[`${otherRole}_amount`])}</strong>. Waiting on them.</p>
      <button class="btn" id="withdraw">Withdraw offer</button>`;
  } else {
    offerHtml = `
      <h3>${esc(them.username)} wants to cash out</h3>
      <p>You get <strong>${credits(b.offer[`${b.role}_amount`])}</strong>, they get <strong>${credits(b.offer[`${otherRole}_amount`])}</strong>, and the bet ends now.</p>
      <div class="btn-row"><button class="btn primary" id="take-offer">Accept</button><button class="btn" id="decline">Decline</button></div>`;
  }

  const disagree = b.creator.report && b.taker.report && b.creator.report !== b.taker.report;
  const reportHtml = started
    ? `
      <h3>How did it end?</h3>
      <p class="muted small">${b.auto_settles ? 'This settles on its own when the final score is in. You can also settle it now: it pays out once you both give the same answer.' : 'It pays out once you both give the same answer.'}</p>
      <div class="btn-row">
        <button class="btn" data-report="${b.role}">I won</button>
        <button class="btn" data-report="${otherRole}">${esc(them.username)} won</button>
        <button class="btn" data-report="push">Push</button>
      </div>
      <p class="small muted">You said: ${whoWon(me.report)} · ${esc(them.username)} said: ${whoWon(them.report)}</p>
      ${disagree ? '<div class="banner warn">You two disagree. Talk it out and change your answer, or settle with a cash-out offer.</div>' : ''}`
    : `<p class="muted small">${b.auto_settles ? 'Settles automatically when the final score is in.' : "After the game, you'll both report the result here. It pays out when you agree."}</p>`;

  actions.innerHTML = `
    <div class="panel">${reportHtml}</div>
    <div class="panel">${offerHtml}<p class="error"></p></div>`;

  const mine = actions.querySelector('#mine');
  mine?.addEventListener('input', () => {
    actions.querySelector('#theirs').value = b.pot - Number(mine.value || 0);
  });
  actions.querySelector('#offer')?.addEventListener('click', (e) => act({ action: 'offer', amount: Number(mine.value) }, e.target));
  actions.querySelector('#withdraw')?.addEventListener('click', (e) => act({ action: 'withdraw' }, e.target));
  actions.querySelector('#take-offer')?.addEventListener('click', (e) => act({ action: 'respond', accept: true }, e.target));
  actions.querySelector('#decline')?.addEventListener('click', (e) => act({ action: 'respond', accept: false }, e.target));
  actions.querySelectorAll('[data-report]').forEach((button) =>
    button.addEventListener('click', () => act({ action: 'report', result: button.dataset.report }, button))
  );
}

// ---- Start ----

window.addEventListener('hashchange', render);
refreshMe()
  .catch(() => {})
  .finally(render);

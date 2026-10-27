// Lines and scores from The Odds API (https://the-odds-api.com), cached in the database to save
// API credits. Without ODDS_API_KEY the site runs on built-in sample lines instead.
import { query } from './db.js';
import { HttpError } from './http.js';
import { SPORTS } from '../public/js/markets.js';

const BASE = 'https://api.the-odds-api.com/v4';
const CACHE_SECONDS = 600;
const PREFERRED_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers'];

export function isDemo() {
  return !process.env.ODDS_API_KEY;
}

export function findSport(key) {
  const sport = SPORTS.find((s) => s.key === key);
  if (!sport) throw new HttpError(400, 'Unknown sport');
  return sport;
}

async function apiGet(path, params) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries({ ...params, apiKey: process.env.ODDS_API_KEY })) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, `The odds service returned an error (${res.status})`);
  return res.json();
}

// Serves a fresh-enough cached copy, otherwise fetches; falls back to a stale copy if the fetch fails.
async function cached(key, fetcher) {
  const { rows } = await query('SELECT data, fetched_at FROM odds_cache WHERE key = $1', [key]);
  const hit = rows[0];
  if (hit && Date.now() - hit.fetched_at.getTime() < CACHE_SECONDS * 1000) return hit.data;
  try {
    const data = await fetcher();
    await query(
      `INSERT INTO odds_cache (key, data, fetched_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
      [key, JSON.stringify(data)]
    );
    return data;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

function sortedBooks(bookmakers = []) {
  const rank = (b) => {
    const i = PREFERRED_BOOKS.indexOf(b.key);
    return i === -1 ? PREFERRED_BOOKS.length : i;
  };
  return [...bookmakers].sort((a, b) => rank(a) - rank(b));
}

function normalizeGame(event) {
  const markets = {};
  for (const key of ['h2h', 'spreads', 'totals']) {
    for (const book of sortedBooks(event.bookmakers)) {
      const market = book.markets?.find((m) => m.key === key);
      if (!market) continue;
      markets[key] = market.outcomes
        .filter((o) => key === 'totals' || o.name === event.home_team || o.name === event.away_team)
        .map((o) => ({ selection: o.name, point: o.point ?? null, price: o.price }));
      break;
    }
  }
  return {
    id: event.id,
    sport_key: event.sport_key,
    commence_time: event.commence_time,
    home_team: event.home_team,
    away_team: event.away_team,
    markets,
  };
}

// One line per player per prop, taken from the most preferred book that offers it.
function normalizeProps(event, propKeys) {
  const props = new Map();
  for (const book of sortedBooks(event.bookmakers)) {
    for (const market of book.markets || []) {
      const byPlayer = new Map();
      for (const o of market.outcomes) {
        if (!o.description) continue;
        if (!byPlayer.has(o.description)) byPlayer.set(o.description, []);
        byPlayer.get(o.description).push(o);
      }
      for (const [player, outcomes] of byPlayer) {
        const key = `${market.key}|${player}`;
        if (props.has(key)) continue;
        // Books sometimes list alternate lines; keep only the main one.
        const point = outcomes[0].point ?? null;
        props.set(key, {
          market: market.key,
          player,
          outcomes: outcomes
            .filter((o) => (o.point ?? null) === point)
            .map((o) => ({ selection: o.name, point, price: o.price })),
        });
      }
    }
  }
  return [...props.values()].sort(
    (a, b) => propKeys.indexOf(a.market) - propKeys.indexOf(b.market) || a.player.localeCompare(b.player)
  );
}

// Upcoming games with moneyline, spread and total for one sport.
export async function getGames(sportKey) {
  findSport(sportKey);
  const games = isDemo()
    ? demoGames(sportKey)
    : await cached(`odds:${sportKey}`, async () =>
        (
          await apiGet(`/sports/${sportKey}/odds`, {
            regions: 'us',
            markets: 'h2h,spreads,totals',
            oddsFormat: 'american',
          })
        ).map(normalizeGame)
      );
  const now = Date.now();
  return games
    .filter((g) => new Date(g.commence_time).getTime() > now)
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time));
}

export async function getProps(sportKey, eventId) {
  const sport = findSport(sportKey);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(eventId || '')) throw new HttpError(400, 'Unknown game');
  if (isDemo()) return demoProps(sportKey, eventId);
  return cached(`props:${sportKey}:${eventId}`, async () =>
    normalizeProps(
      await apiGet(`/sports/${sportKey}/events/${eventId}/odds`, {
        regions: 'us',
        markets: sport.props.join(','),
        oddsFormat: 'american',
      }),
      sport.props
    )
  );
}

// Final and in-progress scores for the last 3 days, used to settle game bets.
export async function getScores(sportKey) {
  if (isDemo()) return [];
  return cached(`scores:${sportKey}`, () => apiGet(`/sports/${sportKey}/scores`, { daysFrom: 3 }));
}

// ---- Sample lines for running without an API key ----

const DEMO_TEAMS = {
  americanfootball_nfl: [['Kansas City Chiefs', 'Buffalo Bills'], ['Philadelphia Eagles', 'Dallas Cowboys'], ['San Francisco 49ers', 'Detroit Lions'], ['Baltimore Ravens', 'Cincinnati Bengals']],
  americanfootball_ncaaf: [['Georgia Bulldogs', 'Alabama Crimson Tide'], ['Ohio State Buckeyes', 'Michigan Wolverines'], ['Texas Longhorns', 'Oklahoma Sooners'], ['Oregon Ducks', 'USC Trojans']],
  basketball_nba: [['Los Angeles Lakers', 'Boston Celtics'], ['Denver Nuggets', 'Golden State Warriors'], ['Milwaukee Bucks', 'New York Knicks'], ['Phoenix Suns', 'Dallas Mavericks']],
  basketball_ncaab: [['Duke Blue Devils', 'North Carolina Tar Heels'], ['Kansas Jayhawks', 'Kentucky Wildcats'], ['UConn Huskies', 'Villanova Wildcats'], ['Gonzaga Bulldogs', 'Arizona Wildcats']],
  baseball_mlb: [['New York Yankees', 'Boston Red Sox'], ['Los Angeles Dodgers', 'San Francisco Giants'], ['Houston Astros', 'Texas Rangers'], ['Atlanta Braves', 'Philadelphia Phillies']],
  icehockey_nhl: [['Toronto Maple Leafs', 'Montreal Canadiens'], ['Edmonton Oilers', 'Calgary Flames'], ['New York Rangers', 'Boston Bruins'], ['Colorado Avalanche', 'Vegas Golden Knights']],
};
const DEMO_TOTALS = {
  americanfootball_nfl: 46.5,
  americanfootball_ncaaf: 53.5,
  basketball_nba: 224.5,
  basketball_ncaab: 142.5,
  baseball_mlb: 8.5,
  icehockey_nhl: 6.5,
};
const DEMO_SPREADS = [-3.5, -6.5, -1.5, -9.5];
const DEMO_PROP_LINES = {
  player_pass_yds: 245.5, player_pass_tds: 1.5, player_rush_yds: 62.5, player_reception_yds: 58.5,
  player_receptions: 4.5, player_anytime_td: null, player_points: 22.5, player_rebounds: 7.5,
  player_assists: 5.5, player_threes: 2.5, player_points_rebounds_assists: 34.5, player_goals: 0.5,
  player_shots_on_goal: 2.5, batter_hits: 0.5, batter_home_runs: 0.5, batter_total_bases: 1.5,
  pitcher_strikeouts: 5.5,
};
const DEMO_PLAYERS = ['Marcus Hale', 'Devin Brooks', 'Tyler Grant', 'Jalen Price', 'Chris Moreno', 'Andre Wallace', 'Luke Bennett', 'Isaiah Ford'];

function demoGames(sportKey) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const lowScoring = sportKey === 'baseball_mlb' || sportKey === 'icehockey_nhl';
  return DEMO_TEAMS[sportKey].map(([home, away], i) => {
    const spread = lowScoring ? -1.5 : DEMO_SPREADS[i];
    const favorite = -(110 + Math.round((Math.abs(DEMO_SPREADS[i]) * 25) / 5) * 5);
    const underdog = -favorite - 20;
    return {
      id: `demo-${sportKey}-${i}`,
      sport_key: sportKey,
      commence_time: new Date(day.getTime() + (i + 1) * 86400000 + 23 * 3600000).toISOString(),
      home_team: home,
      away_team: away,
      markets: {
        h2h: [
          { selection: away, point: null, price: underdog },
          { selection: home, point: null, price: favorite },
        ],
        spreads: [
          { selection: away, point: -spread, price: lowScoring ? 150 : -110 },
          { selection: home, point: spread, price: lowScoring ? -170 : -110 },
        ],
        totals: [
          { selection: 'Over', point: DEMO_TOTALS[sportKey], price: -110 },
          { selection: 'Under', point: DEMO_TOTALS[sportKey], price: -110 },
        ],
      },
    };
  });
}

function demoProps(sportKey, eventId) {
  const index = Number(eventId.split('-').pop());
  if (!eventId.startsWith(`demo-${sportKey}-`) || !DEMO_TEAMS[sportKey][index]) {
    throw new HttpError(404, 'That game is no longer available');
  }
  const players = [DEMO_PLAYERS[index * 2], DEMO_PLAYERS[index * 2 + 1]];
  return findSport(sportKey).props.flatMap((market) =>
    players.map((player) => {
      const point = DEMO_PROP_LINES[market];
      return {
        market,
        player,
        outcomes:
          point == null
            ? [{ selection: 'Yes', point: null, price: 140 }, { selection: 'No', point: null, price: -180 }]
            : [{ selection: 'Over', point, price: -115 }, { selection: 'Under', point, price: -105 }],
      };
    })
  );
}

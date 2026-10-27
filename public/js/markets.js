// Bet sides, labels, payouts and grading. Shared by the browser and the API.

export const SPORTS = [
  { key: 'americanfootball_nfl', title: 'NFL', props: ['player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_anytime_td'] },
  { key: 'americanfootball_ncaaf', title: 'NCAAF', props: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_anytime_td'] },
  { key: 'basketball_nba', title: 'NBA', props: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'] },
  { key: 'basketball_ncaab', title: 'NCAAB', props: ['player_points', 'player_rebounds', 'player_assists'] },
  { key: 'baseball_mlb', title: 'MLB', props: ['batter_hits', 'batter_home_runs', 'batter_total_bases', 'pitcher_strikeouts'] },
  { key: 'icehockey_nhl', title: 'NHL', props: ['player_points', 'player_goals', 'player_shots_on_goal'] },
];

export const MARKET_NAMES = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total',
  player_pass_yds: 'Passing Yards',
  player_pass_tds: 'Passing TDs',
  player_rush_yds: 'Rushing Yards',
  player_reception_yds: 'Receiving Yards',
  player_receptions: 'Receptions',
  player_anytime_td: 'Anytime TD',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: 'Threes Made',
  player_points_rebounds_assists: 'Pts + Reb + Ast',
  player_goals: 'Goals',
  player_shots_on_goal: 'Shots on Goal',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_total_bases: 'Total Bases',
  pitcher_strikeouts: 'Strikeouts (Pitcher)',
};

const FLIP = { Over: 'Under', Under: 'Over', Yes: 'No', No: 'Yes' };

export function isGameMarket(market) {
  return market === 'h2h' || market === 'spreads' || market === 'totals';
}

// The side the person taking the bet gets: the other team, or the other half of an over/under or yes/no.
export function otherSide(bet) {
  if (bet.market === 'h2h' || bet.market === 'spreads') {
    const selection = bet.selection === bet.home_team ? bet.away_team : bet.home_team;
    return { selection, point: bet.market === 'spreads' ? -bet.point : null };
  }
  return { selection: FLIP[bet.selection], point: bet.point };
}

export function formatPoint(point) {
  if (point === 0) return 'PK';
  return point > 0 ? `+${point}` : `${point}`;
}

export function formatPrice(price) {
  return price > 0 ? `+${price}` : `${price}`;
}

export function sideLabel(bet, side) {
  if (bet.market === 'h2h') return `${side.selection} to win`;
  if (bet.market === 'spreads') return `${side.selection} ${formatPoint(side.point)}`;
  if (bet.market === 'totals') return `${side.selection} ${side.point}`;
  const name = MARKET_NAMES[bet.market] || bet.market;
  if (side.point == null) return `${bet.player} ${name}: ${side.selection}`;
  return `${bet.player} ${side.selection} ${side.point} ${name}`;
}

export function isValidPrice(price) {
  return Number.isInteger(price) && (price >= 100 || price <= -100);
}

// What a stake wins at American odds, which is what the other side has to put up.
export function matchStake(stake, price) {
  const win = price > 0 ? (stake * price) / 100 : (stake * 100) / -price;
  return Math.max(1, Math.round(win));
}

// Grades a game bet from the final score, from the creator's point of view.
export function gradeGame(bet, homeScore, awayScore) {
  let margin;
  if (bet.market === 'totals') {
    const total = homeScore + awayScore;
    margin = bet.selection === 'Over' ? total - bet.point : bet.point - total;
  } else {
    const home = bet.selection === bet.home_team;
    margin = (home ? homeScore - awayScore : awayScore - homeScore) + (bet.market === 'spreads' ? bet.point : 0);
  }
  if (margin > 0) return 'creator';
  if (margin < 0) return 'taker';
  return 'push';
}

// [creator payout, taker payout] for a final result.
export function payouts(bet, result) {
  const pot = bet.creator_stake + bet.taker_stake;
  if (result === 'creator') return [pot, 0];
  if (result === 'taker') return [0, pot];
  return [bet.creator_stake, bet.taker_stake];
}

# SideBet

Bet your friends instead of the house. Pick a spread, moneyline, total or player prop, set the
stakes, and send the invite link (or post it on the open board). Both stakes sit in escrow until
the bet ends, and the winner takes the pot. Either side can offer to cash out early for an agreed
split. Everyone plays with credits; no real money changes hands.

Plain HTML, CSS and JavaScript in `public/`, Vercel functions in `api/`, and a Postgres database.

## How a bet works

1. **Make it.** Tap a line. You can change the line, the odds and both stakes before sending.
   Your stake leaves your balance and goes into escrow.
2. **Share it.** Send the invite link, or also post it on the open board for anyone to take.
   If nobody takes it before the game starts, it is refunded.
3. **Take it.** The other person's stake goes into escrow too. The bet is locked in.
4. **Settle it.**
   - Spreads, moneylines and totals settle on their own from the final score (needs an Odds API key).
   - Player props, and any bet when running on sample lines: both people tap who won. It pays
     out as soon as the answers match.
   - **Cash out early:** either side offers a split of the pot. If the other accepts, it pays out
     right away and the bet ends.

## Deploy on Vercel

1. Import this repo in Vercel. Keep the default settings (no build command).
2. In the project, open **Storage → Create Database → Neon (Postgres)** and connect it. That sets
   `DATABASE_URL` for you. Tables are created automatically on the first request.
3. Optional: get a free key at [the-odds-api.com](https://the-odds-api.com) and add it as the
   `ODDS_API_KEY` environment variable. Without it, the site runs on sample lines.
4. Redeploy so the new environment variables take effect.

The free Odds API plan is 500 credits a month. Lines and scores are cached for 10 minutes to stretch that.

## Run it locally

```sh
npm install
cp .env.example .env   # then fill in DATABASE_URL (and ODDS_API_KEY if you have one)
npm run dev            # http://localhost:3000
npm test               # set TEST_DATABASE_URL to a throwaway database for the escrow tests
```

## Layout

- `public/` – the site. `js/markets.js` holds the bet math and labels, shared with the API.
- `api/auth.js` – sign up, log in, log out.
- `api/lines.js` – games and player props from The Odds API (or sample lines).
- `api/bets.js` – create, take, cancel, report results, cash-out offers.
- `lib/` – database, sessions, odds feed and the escrow logic.

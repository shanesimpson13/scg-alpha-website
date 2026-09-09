# EdgeLvl

The terminal at [edgelvl.app](https://edgelvl.app) — the board you watch, the
button you press, and the wallet you own.

One of three repos:

| Repo | What it is |
|---|---|
| this one | the terminal, as static HTML and vanilla JS |
| [edgelvl-bot](https://github.com/shanesimpson13/edgelvl-bot) | the trading system — strategy, executors, custody signing |
| [edgelvl-api](https://github.com/shanesimpson13/edgelvl-api) | the server between them |

## The idea

A bot that waits is worth more than a bot that decides. You pick the coin —
that judgement is the part software is worst at — and press greenlight. From
there it watches the price every second, waits for a dip and a reclaim rather
than buying a vertical top, and takes profit on a ladder while you are asleep.

Nothing trades without your tap. The terminal never touches a wallet; it only
queues your greenlight against your account.

## Pages

| File | What it is |
|---|---|
| `index.html` | the terminal — board, coin pages, wallet, settings, journal |
| `start.html` | the onboarding walk-through |
| `demo.html` | the strategy playing out on a real chart |
| `deck.html` | what the thing is, for someone seeing it cold |
| `safety.html`, `terms.html`, `privacy.html` | the boring, necessary ones |

## Two chains

Solana and Robinhood Chain. Switching chains switches the product, not a
filter: board, positions, journal and wallet are all per chain, because they
are different addresses holding different money. A page that blends them for
even a second is worse than an empty one — the thing you act on is which coin
is in front of you.

## Building it

There is no build. It is HTML, CSS and vanilla JS in one file, served static,
and it talks to `api.edgelvl.app`. Open `index.html` and it runs.

The Privy app id in the source is a public client identifier — it is shipped to
every browser that loads the page. Nothing secret lives here.

# EdgeLvl Terminal — build spec

**Goal:** replace "38 Telegram cards a day" with one screen showing the 3–5 coins that
are actually moving right now. Click one, look at it, greenlight it. The bot on the
buyer's machine does the trading.

**The custody line — this is the whole point of the design:**
the terminal handles *seeing and deciding*. The buyer's own bot handles *keys and
execution*. We never hold funds, never see a private key, and never sign anything.

```
  edgelvl.app/terminal          api.scgalpha.com              buyer's machine
  ┌────────────────┐            ┌──────────────┐             ┌──────────────┐
  │ top 5 by       │  POST      │  greenlight  │   poll      │  bot.py      │
  │ CURRENT volume │ ────────▶  │  queue       │ ◀────────── │  (their key, │
  │ [Greenlight]   │            │  (per key)   │             │ their wallet)│
  └────────────────┘            └──────────────┘             └──────┬───────┘
                                                                    │
                                                        Telegram ◀──┘
                                              armed → bought → TP1 → TP2 → P&L
```

---

## Part 1 — Live volume (the hard part, do this first)

**The board sorts on current volume and nothing else.** That's the product decision, so
everything hinges on having a *current* volume number per recently-alerted coin.

**Problem:** the alert payload has no volume field. `/api/journal` gives `pc5`, `pc1h`,
`liquidity`, `holders` — no volume. Volume at alert time wouldn't help anyway; the board
needs volume *now*.

**Solution — nearly free:** the vault already calls GMGN `/v1/market/rank` every scan
cycle, and each token in that response already carries `volume`, `buys`, `sells`. Today
those are read for tracking and then discarded. Capture them instead.

### 1a. Vault: write a live volume cache

In the scan loop where `tokens` is iterated, upsert every token seen:

```python
# live_volume.json  — { mint: {"vol": float, "buys": int, "sells": int, "ts": float} }
_live_vol[mint] = {
    "vol":   float(t.get("volume", 0) or 0),
    "buys":  int(t.get("buys", 0) or 0),
    "sells": int(t.get("sells", 0) or 0),
    "ts":    time.time(),
}
```

Flush to `/home/ubuntu/vault/live_volume.json` once per cycle (atomic write: tmp + rename).
Prune entries older than 6h so the file stays small.

**No new GMGN calls. No new rate-limit exposure.** This matters — the GMGN key is shared
with the live vault, and a ban takes the whole product down.

> **A coin that has fallen off the trending list won't get refreshed — and that's correct.**
> Absent from the rank feed means volume has collapsed, which means it belongs at the
> bottom of the board. Treat a stale `ts` (> 10 min) as "cooling" and sort it down.

### 1b. API: serve alerts with live volume attached

New endpoint, gated by license key exactly like `/api/journal`:

```
GET /api/terminal?hours=24&limit=5
Authorization: Bearer <whop_license_key>
```

Server-side:
1. load alerts from the last `hours`
2. join each to `live_volume.json` by mint
3. **sort by `vol` descending**
4. return the top `limit`

```json
{
  "generated_at": 1785470000.0,
  "coins": [
    {
      "mint": "HqDrYq…", "name": "Jimothy",
      "vol_now": 546000.0,          // ← the sort key
      "buys": 3661, "sells": 3064,
      "vol_age_secs": 45,           // staleness of the volume reading
      "state": "hot",               // hot | cooling | dead   (see below)
      "alert_mcap": 185900, "current_mcap": 210400, "max_mcap": 350900,
      "liquidity": 27800, "holders": 279, "holder_growth_pct": 17.2,
      "pc5": 61.0, "pc1h": 643.0,
      "alert_time": 1785469838.0, "alert_age_mins": 12
    }
  ]
}
```

**`state` field** — this is the guard against the failure we measured (arming coins whose
move already finished):

| state | rule | UI |
|---|---|---|
| `hot` | volume fresh (< 5 min) and `vol_now` in the top few | green, greenlight enabled |
| `cooling` | volume reading 5–15 min old, or volume down sharply | amber, greenlight enabled with a warning |
| `dead` | no volume reading in 15+ min | grey, **greenlight disabled** |

Arming a `dead` coin just burns the bot's 60-minute entry timeout. Don't let people do it.

---

## Part 2 — Greenlight queue

Two endpoints, both keyed by license key so users are isolated from each other.

```
POST /api/greenlight        { "mint": "HqDrYq…" }      → 200 {"queued": true}
GET  /api/greenlights                                   → {"mints": ["HqDrYq…"]}
POST /api/greenlights/ack   { "mint": "HqDrYq…" }      → 200   (bot confirms it armed)
```

**Storage:** `{license_key: {mint: queued_at}}`. A JSON file is fine at this scale.
**Expiry:** drop anything unacked after 10 minutes — if the buyer's bot is offline, a
greenlight shouldn't fire an hour later when they've forgotten about it.

### Bot side (~15 lines in `bot.py`)

Add to the existing poll loop, alongside `tg_poll_taps`:

```python
async def poll_web_greenlights(s):
    """Greenlights tapped in the web terminal. Same effect as tapping in Telegram."""
    while True:
        try:
            async with s.get(f"{C.EDGE_API}/api/greenlights",
                             headers={"Authorization": f"Bearer {C.EDGE_API_KEY}"},
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
                mints = (await r.json()).get("mints", []) if r.status == 200 else []
        except Exception:
            mints = []
        for mint in mints:
            if mint in live_sessions:
                continue
            sig = await lookup_signal(s, mint)
            if sig:
                asyncio.create_task(work_coin(s, sig))
            await s.post(f"{C.EDGE_API}/api/greenlights/ack", json={"mint": mint},
                         headers={"Authorization": f"Bearer {C.EDGE_API_KEY}"})
        await asyncio.sleep(5)
```

Telegram keeps working exactly as it does now. The web terminal is a second way to arm
the same session — not a replacement.

---

## Part 3 — The terminal UI

`edgelvl.app/terminal`. Same visual language as the funnel: black, `#7cffa0` accent,
monospace.

**Auth:** paste license key once, store in `localStorage`. Invalid key → prompt again.

### Board (default view)

Top 5 by current volume, refreshing every 15s.

```
┌──────────────────────────────────────────────────────────────┐
│  ● LIVE          top 5 by volume, last 24h        15:24:08   │
├──────────────────────────────────────────────────────────────┤
│  JIMOTHY            $546K vol   ● hot                        │
│  MC $186K → $210K · ATH $351K   5m +61%  1h +643%            │
│  Liq $27.8K · 279 holders +17%          alerted 12m ago      │
├──────────────────────────────────────────────────────────────┤
│  CALLDOG            $128K vol   ● cooling                    │
│  …                                                            │
└──────────────────────────────────────────────────────────────┘
```

Volume is the largest number on each row — it's the sort key and the decision.

### Detail (on click)

- **GMGN chart** — iframe if their embed allows it, otherwise a prominent link out.
  Don't rebuild charting.
- Full stats: MC / ATH / now, liquidity, holders + growth, 5m and 1h momentum,
  top-10 %, dev %, launchpad, mint (click to copy)
- Twitter link when `twitter_handle` is present — narrative check, per Module 04
- **[ 🟢 GREENLIGHT ]** — disabled with a tooltip when `state == "dead"`

### Status strip

After greenlighting, show a lightweight timeline for that coin: `queued → armed → …`.
`queued` comes from our own POST; `armed` onward requires the bot to report back.

> **v1: don't build bot→web status reporting.** Show `queued`, then the line
> *"the rest lands in Telegram."* It's one more endpoint and a bunch of state sync for
> something the buyer is already getting on their phone. Add it in v2 if people ask.

---

## Build order

1. **Vault volume cache** — half a day. Nothing else works without it.
2. **`/api/terminal`** — half a day.
3. **Greenlight queue + bot polling** — half a day.
4. **Terminal UI** — 3–4 days.

Roughly a week. Steps 1–2 are worth doing regardless: live volume on the signal makes
the *Telegram* cards better too, and volume is the one thing Module 04 says to judge on.

## Things that will bite

- **GMGN rate limits.** Reuse data the vault already fetches. Never add a per-coin poll
  loop against GMGN — a ban takes the whole product offline.
- **Stale volume looks like low volume.** Always surface `vol_age_secs` in the UI so a
  refresh gap doesn't read as a dead coin.
- **The terminal must not become a second source of truth.** The bot owns positions and
  P&L; the terminal shows signals and takes intent. Don't duplicate position state.
- **Key in `localStorage`** is fine for a $29 tool, but it is the buyer's membership key —
  never log it server-side, and always serve the terminal over HTTPS only.

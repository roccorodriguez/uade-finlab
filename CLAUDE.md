# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
# Activate virtual environment (Windows)
source venv/Scripts/activate

# Install dependencies
pip install -r requirements.txt

# Start the server (with hot reload)
uvicorn main:app --reload
```

App runs at `http://127.0.0.1:8000`. The frontend is served from `static/` as a SPA.

## Environment variables (`.env` required)

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string (required — app crashes without it) |
| `GEMINI_API_KEY` | Google Gemini API for the AI chat feature |
| `BREVO_API_KEY` | Brevo (Sendinblue) API for sending verification emails |

## Architecture

Single-file backend (`main.py`) + vanilla JS frontend (`static/`).

**Data flow:**
- All persistent data lives in **MongoDB Atlas** (`finlab_db`) via `MongoHandler`, with three collections: `students`, `config`, `metadata`.
- Market prices come from **yfinance** with two in-memory caches: price cache (10s TTL) and fundamentals cache (1h TTL).
- The frontend calls the FastAPI backend at `/api/*` endpoints.

**Key backend concepts:**
- `fetch_yfinance_data()` fetches prices for all visible symbols + all symbols held in any student portfolio.
- `SYMBOL_EXCEPTIONS` maps internal symbols to yfinance tickers (e.g. `BTC` → `BTC-USD`).
- `asset_metadata.json` and `market_config.json` are local fallback/seed files; actual source of truth is MongoDB.
- Authentication uses email-based OTP: username + `@uade.edu.ar` → 6-digit code sent via Brevo → verified in memory (`PENDING_CODES` dict, not persisted).
- Copa reset is protected by a hardcoded password (`COPA_PASSWORD`).

**Frontend (`static/`):** `index.html` + `script.js` + `styles.css` — no build step, no framework.

## Test / debug script

```bash
python test_heat.py   # fetches commodities & indices via yfinance, prints results
```

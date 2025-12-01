from fastapi import FastAPI, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
from typing import Dict, List, Set
import json
import os
import time
import math
import builtins

app = FastAPI()

DB_FILE = "student_db.json" 
MARKET_CONFIG_FILE = "market_config.json"
METADATA_FILE = "asset_metadata.json"

MARKET_DATA_CACHE = {"data": {}, "timestamp": 0} 
CACHE_DURATION_SECONDS = 30

SYMBOL_EXCEPTIONS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD"
}

class AssetData(BaseModel):
    name: str
    price: float
    change_percent: float
    volatility: float
    sector: str

class UserPortfolio(BaseModel):
    balance: float
    portfolio: Dict[str, float]
    initial: float
    
class TradeRequest(BaseModel):
    legajo: str
    asset: str
    quantity: int
    type: str

class StudentRanking(BaseModel):
    legajo: str
    total: float
    roi: float

class AddAssetRequest(BaseModel):
    symbol: str

def load_db():
    if not os.path.exists(DB_FILE):
        initial_db = {
            '999001': {'balance': 5000.0, 'portfolio': {'BTC': 1.05}, 'initial': 100000.0},
            '999002': {'balance': 102000.0, 'portfolio': {}, 'initial': 100000.0},
        }
        with open(DB_FILE, 'w') as f:
            json.dump(initial_db, f)
        return initial_db
    
    with open(DB_FILE, 'r') as f:
        return json.load(f)

def save_db(db_data):
    with open(DB_FILE, 'w') as f:
        json.dump(db_data, f, indent=4)

def load_market_config() -> List[str]:
    if not os.path.exists(MARKET_CONFIG_FILE):
        initial_symbols = ["GGAL", "YPF", "MELI", "BTC", "AAPL"]
        with open(MARKET_CONFIG_FILE, 'w') as f:
            json.dump(initial_symbols, f)
        return initial_symbols

    with open(MARKET_CONFIG_FILE, 'r') as f:
        return json.load(f)

def save_market_config(symbols: List[str]):
    with open(MARKET_CONFIG_FILE, 'w') as f:
        json.dump(symbols, f, indent=4)

def get_yahoo_ticker(symbol: str) -> str:
    return SYMBOL_EXCEPTIONS.get(symbol, symbol)

def load_metadata() -> Dict:
    if not os.path.exists(METADATA_FILE):
        return {}
    with open(METADATA_FILE, 'r') as f:
        return json.load(f)

def save_metadata(data: Dict):
    with open(METADATA_FILE, 'w') as f:
        json.dump(data, f, indent=4)

def fetch_yfinance_data(force_update: bool = False):
    global MARKET_DATA_CACHE

    if not force_update and (time.time() - MARKET_DATA_CACHE["timestamp"] < CACHE_DURATION_SECONDS):
        return MARKET_DATA_CACHE["data"]

    visible_symbols = load_market_config()

    student_db = load_db()
    portfolio_symbols = set()
    for record in student_db.values():
        portfolio_symbols.update(record['portfolio'].keys())
    
    all_needed_symbols = set(visible_symbols).union(portfolio_symbols)

    if not all_needed_symbols:
        return {}
        
    yf_tickers_map = {s: get_yahoo_ticker(s) for s in all_needed_symbols}
    tickers_to_download = list(yf_tickers_map.values())
    
    try:
        print(f"⬇ Descargando precios para: {tickers_to_download}")

        data = yf.download(tickers_to_download, period="1d", group_by="ticker", progress=False)
        
        results = {}
        
        for symbol in all_needed_symbols:
            yf_ticker = yf_tickers_map[symbol]

            try:
                if len(tickers_to_download) == 1:
                    ticker_data = data
                else:
                    if yf_ticker not in data.columns.levels[0]:
                        continue
                    ticker_data = data[yf_ticker]

                if ticker_data.empty:
                    current_price = 0.0
                    change_percent = 0.0
                else:
                    raw_close = ticker_data["Close"].iloc[-1]
                    raw_open = ticker_data["Open"].iloc[-1]

                    try:
                        val_close = float(raw_close)
                        if math.isnan(val_close) or math.isinf(val_close):
                            current_price = 0.0
                        else:
                            current_price = val_close
                    except:
                        current_price = 0.0

                    try:
                        val_open = float(raw_open)
                        if math.isnan(val_open) or math.isinf(val_open):
                            open_price = 0.0
                        else:
                            open_price = val_open
                    except:
                        open_price = 0.0

                    if open_price != 0:
                        change_percent = ((current_price - open_price) / open_price) * 100
                    else:
                        change_percent = 0.0

                    if math.isnan(change_percent) or math.isinf(change_percent):
                        change_percent = 0.0

                meta_cache = load_metadata()
                asset_meta = meta_cache.get(symbol, {})

                results[symbol] = {
                    "name": asset_meta.get("name", symbol),
                    "price": round(current_price, 2),
                    "change_percent": round(change_percent, 2),
                    "volatility": asset_meta.get("volatility", 1.0),
                    "sector": asset_meta.get("sector", "General")
                }
            except Exception as e:
                print(f"⚠️ Error procesando {symbol}: {e}")
                results[symbol] = {
                    "name": symbol, "price": 0.0, "change_percent": 0.0, "volatility": 0, "sector": "N/A"
                }

        MARKET_DATA_CACHE["data"] = results
        MARKET_DATA_CACHE["timestamp"] = time.time()
        return results
    except Exception as e:
        print(f"Error crítico en YFinance: {e}")
        if MARKET_DATA_CACHE["data"]: return MARKET_DATA_CACHE["data"]
        return {}

@app.get("/api/market-data", response_model=Dict[str, AssetData])
def get_market_data():
    all_data = fetch_yfinance_data()
    visible_symbols = load_market_config()
    filtered_data = {k: v for k, v in all_data.items() if k in visible_symbols}
    return filtered_data

@app.get("/api/leaderboard", response_model=List[StudentRanking])
def get_leaderboard_data():
    db = load_db()
    current_prices = fetch_yfinance_data()

    students = []
    for legajo, record in db.items():
        holdings_value = 0
        
        for symbol, qty in record['portfolio'].items():
            price = current_prices.get(symbol, {}).get("price", 0) 
            holdings_value += qty * price
        
        total_capital = record['balance'] + holdings_value
        
        initial = record.get('initial', 100000.0)
        roi = ((total_capital - initial) / initial) * 100 if initial else 0

        students.append({
            'legajo': legajo,
            'total': round(total_capital, 2),
            'roi': round(roi, 2)
        })

    students.sort(key=lambda s: s['roi'], reverse=True)
    return students

@app.post("/api/trade")
def execute_trade(req: TradeRequest):
    db = load_db()
    user_data = db.get(req.legajo)
    
    if not user_data:
        raise HTTPException(status_code=404, detail="Legajo no encontrado.")
        
    prices = fetch_yfinance_data()
    asset_price = prices.get(req.asset, {}).get("price")
    
    if not asset_price or asset_price == 0:
        raise HTTPException(status_code=400, detail="Activo no negociable o precio no disponible.")

    total_cost = asset_price * req.quantity
    
    if req.type == 'buy':
        if user_data['balance'] < total_cost:
            raise HTTPException(status_code=400, detail="Saldo insuficiente.")
        
        user_data['balance'] -= total_cost
        user_data['portfolio'][req.asset] = user_data['portfolio'].get(req.asset, 0) + req.quantity
        
    elif req.type == 'sell':
        current_qty = user_data['portfolio'].get(req.asset, 0)
        if current_qty < req.quantity:
            raise HTTPException(status_code=400, detail=f"Solo tienes {current_qty} acciones de {req.asset}.")
            
        user_data['balance'] += total_cost
        user_data['portfolio'][req.asset] -= req.quantity
        if user_data['portfolio'][req.asset] < 0.001:
             user_data['portfolio'].pop(req.asset)

    db[req.legajo] = user_data
    save_db(db)
    
    return {"status": "success", "userData": user_data}

@app.post("/api/market/add")
def add_market_asset(req: AddAssetRequest):
    symbol = req.symbol.strip().upper()

    config = load_market_config()
    metadata = load_metadata()

    if symbol in config:
        raise HTTPException(status_code=400, detail=f"El activo {symbol} ya está en la lista.")

    yf_ticker = get_yahoo_ticker(symbol)

    try:
        print(f"🔍 Verificando {symbol} ({yf_ticker}) en Yahoo...")
        ticker_obj = yf.Ticker(yf_ticker)

        try:
            _ = ticker_obj.fast_info["last_price"]
        except:
            hist = ticker_obj.history(period="1d")
            if hist.empty:
                raise Exception("No data found")
        
        all_prices = fetch_yfinance_data(force_update=True)

        current_price = all_prices.get(symbol, {}).get("price", 0.0)

        if current_price == 0.0:
            raise HTTPException(status_code=404, detail=f"El activo {symbol} no tiene precio operable disponible.")
        
        info = ticker_obj.info

        asset_name = info.get("shortName", info.get("longName", symbol))
        asset_sector = info.get("sector", "General")
        asset_volatility = info.get("beta", 1.0)
        if asset_volatility is None: asset_volatility = 1.0

        metadata[symbol] = {
            "name": asset_name,
            "sector": asset_sector,
            "volatility": asset_volatility
        }
        save_metadata(metadata)

        config.insert(0, symbol)
        save_market_config(config)

        return {
            "status": "success",
            "message": f"{symbol} agregado correctamente.",
            "data": metadata[symbol]
        }
    except Exception as e:
        print(f"❌ Error agregando {symbol}: {e}")
        raise HTTPException(status_code=404, detail=f"No se encontró el activo '{symbol}' en el mercado o hubo error de conexión.")

@app.delete("/api/market/{symbol}")
def remove_market_asset(symbol: str):
    symbol = symbol.upper()
    config = load_market_config()

    if symbol not in config:
        raise HTTPException(status_code=404, detail="El activo no está en la lista.")

    config.remove(symbol)
    save_market_config(config)

    return {"status": "success", "message": f"{symbol} eliminado de la vista."}
    
@app.get("/api/db/{legajo}")
def get_user_data(legajo: str):
    db = load_db()
    data = db.get(legajo)
    if not data:
        data = {'balance': 100000.0, 'portfolio': {}, 'initial': 100000.0}
        db[legajo] = data
        save_db(db)
    return data

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mensaje": "El servidor Python está vivo y funcionando"}

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')
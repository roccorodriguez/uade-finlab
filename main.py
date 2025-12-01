from fastapi import FastAPI, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
from typing import Dict, List
import json
import os
import time

app = FastAPI()

DB_FILE = "student_db.json" 

MARKET_DATA_CACHE = {"data": {}, "timestamp": 0} 
CACHE_DURATION_SECONDS = 30

TICKER_MAP = {
    "GGAL": "GGAL", "YPFD": "YPF", "MELI": "MELI", "MSFT": "MSFT", 
    "AAPL": "AAPL", "TSLA": "TSLA", "BTC": "BTC-USD",
}
ACTIVE_SYMBOLS = list(TICKER_MAP.keys())

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

def fetch_yfinance_data(symbols: List[str]):
    global MARKET_DATA_CACHE

    if time.time() - MARKET_DATA_CACHE["timestamp"] < CACHE_DURATION_SECONDS:
        return MARKET_DATA_CACHE["data"]
        
    yf_symbols = [TICKER_MAP[s] for s in symbols if s in TICKER_MAP]
    
    try:
        data = yf.download(yf_symbols, period="1d", progress=False)
        data = data.fillna(0)
        
        results = {}
        for symbol, yf_ticker in TICKER_MAP.items():
            if symbol not in symbols or symbol not in ACTIVE_SYMBOLS:
                continue

            ticker_obj = yf.Ticker(yf_ticker)
            info = ticker_obj.info

            current_price = info.get("regularMarketPrice") 
            
            price_for_change_base = info.get("previousClose", current_price)
            
            current_price = 0.00 if current_price is None or current_price == 0 else float(current_price)
            price_for_change_base = 0.00 if price_for_change_base is None or price_for_change_base == 0 else float(price_for_change_base)

            if current_price == 0.00:
                 current_price = price_for_change_base

            change_percent = ((current_price - price_for_change_base) / price_for_change_base) * 100 if price_for_change_base else 0

            results[symbol] = {
                "name": info.get("shortName", f"{symbol} Asset"),
                "price": round(current_price, 2),
                "change_percent": round(change_percent, 2),
                "volatility": info.get("beta", 1.0) * 0.01,
                "sector": info.get("sector", "General"),
            }

        MARKET_DATA_CACHE["data"] = results
        MARKET_DATA_CACHE["timestamp"] = time.time()
        return results

    except Exception as e:
        print(f"Error al obtener datos de YFinance: {e}")
        if MARKET_DATA_CACHE["data"]:
            return MARKET_DATA_CACHE["data"] 
        raise HTTPException(status_code=503, detail="Error al conectar con la API de precios financieros.")

@app.get("/api/market-data", response_model=Dict[str, AssetData])
def get_market_data():
    return fetch_yfinance_data(ACTIVE_SYMBOLS)

@app.get("/api/leaderboard", response_model=List[StudentRanking])
def get_leaderboard_data():
    db = load_db()
    current_prices = fetch_yfinance_data(ACTIVE_SYMBOLS)

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
        
    prices = fetch_yfinance_data(ACTIVE_SYMBOLS)
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
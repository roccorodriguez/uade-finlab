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

# ===================== DATOS GLOBALES Y CACHÉ =====================

# Almacenamiento temporal de la DB (simula una base de datos real)
# En producción, esto sería PostgreSQL o MongoDB. Usamos un JSON simple por ahora.
DB_FILE = "student_db.json" 

# Cache para evitar llamar a YFinance en cada milisegundo (optimización)
MARKET_DATA_CACHE = {"data": {}, "timestamp": 0} 
CACHE_DURATION_SECONDS = 30 # Actualiza YFinance cada 30 segundos

# Lista de tickers a monitorear (siempre debe ser la fuente de verdad)
TICKER_MAP = {
    "GGAL": "GGAL", "YPFD": "YPF", "MELI": "MELI", "MSFT": "MSFT", 
    "AAPL": "AAPL", "TSLA": "TSLA", "BTC": "BTC-USD",
}
# La lista de símbolos que están actualmente "activos" en el mercado simulado.
ACTIVE_SYMBOLS = list(TICKER_MAP.keys())

# ===================== MODELOS DE DATOS (Pydantic) =====================

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
    type: str # 'buy' o 'sell'

class StudentRanking(BaseModel):
    legajo: str
    total: float
    roi: float

# ===================== LÓGICA DE BASE DE DATOS =====================

def load_db():
    if not os.path.exists(DB_FILE):
        # Crear DB inicial si no existe
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

# ===================== FUNCIÓN CORE: OBTENER DATOS DE YFINANCE =====================

def fetch_yfinance_data(symbols: List[str]):
    """Función central para obtener datos de YFinance con caché."""
    global MARKET_DATA_CACHE

    if time.time() - MARKET_DATA_CACHE["timestamp"] < CACHE_DURATION_SECONDS:
        return MARKET_DATA_CACHE["data"]
        
    yf_symbols = [TICKER_MAP[s] for s in symbols if s in TICKER_MAP]
    
    try:
        # Descargamos data, pero esta vez solo para obtener el precio de apertura/cierre anterior oficial
        # y para tener un punto de referencia para el cambio porcentual.
        # Quitamos interval='5m' para más estabilidad en period="1d".
        data = yf.download(yf_symbols, period="1d", progress=False)
        data = data.fillna(0) # Sanitizar por si acaso
        
        results = {}
        for symbol, yf_ticker in TICKER_MAP.items():
            if symbol not in symbols or symbol not in ACTIVE_SYMBOLS:
                continue

            ticker_obj = yf.Ticker(yf_ticker)
            info = ticker_obj.info

            # 1. FUENTE DE VERDAD: regularMarketPrice (funciona en horario y fuera de horario)
            current_price = info.get("regularMarketPrice") 
            
            # 2. PUNTO DE REFERENCIA (Para calcular el % de cambio)
            # Usamos el precio de cierre anterior como base para el cambio.
            price_for_change_base = info.get("previousClose", current_price)
            
            # 3. Validar y Sanitizar
            current_price = 0.00 if current_price is None or current_price == 0 else float(current_price)
            price_for_change_base = 0.00 if price_for_change_base is None or price_for_change_base == 0 else float(price_for_change_base)

            # Si el precio actual es cero (ni siquiera lo reporta), usamos el cierre anterior como precio.
            if current_price == 0.00:
                 current_price = price_for_change_base

            # 4. Calcular el cambio (vs Cierre Anterior)
            change_percent = ((current_price - price_for_change_base) / price_for_change_base) * 100 if price_for_change_base else 0

            results[symbol] = {
                "name": info.get("shortName", f"{symbol} Asset"),
                "price": round(current_price, 2),
                "change_percent": round(change_percent, 2),
                "volatility": info.get("beta", 1.0) * 0.01,
                "sector": info.get("sector", "General"),
            }

        # Actualizar caché
        MARKET_DATA_CACHE["data"] = results
        MARKET_DATA_CACHE["timestamp"] = time.time()
        return results

    except Exception as e:
        print(f"Error al obtener datos de YFinance: {e}")
        # Si falla YFinance, devolver la última data válida del caché
        if MARKET_DATA_CACHE["data"]:
            return MARKET_DATA_CACHE["data"] 
        raise HTTPException(status_code=503, detail="Error al conectar con la API de precios financieros.")


# ===================== ENDPOINTS DE DATOS Y CÁLCULO =====================

@app.get("/api/market-data", response_model=Dict[str, AssetData])
def get_market_data():
    """Endpoint principal de consulta de precios en tiempo real."""
    return fetch_yfinance_data(ACTIVE_SYMBOLS)

@app.get("/api/leaderboard", response_model=List[StudentRanking])
def get_leaderboard_data():
    """Calcula el valor del portafolio y el ROI para el ranking."""
    db = load_db()
    current_prices = fetch_yfinance_data(ACTIVE_SYMBOLS) # Precios frescos

    students = []
    for legajo, record in db.items():
        holdings_value = 0
        
        # 1. Calcular el valor del portafolio (Net Worth)
        for symbol, qty in record['portfolio'].items():
            # Usar precio real (del caché) para la valoración
            price = current_prices.get(symbol, {}).get("price", 0) 
            holdings_value += qty * price
        
        total_capital = record['balance'] + holdings_value
        
        # 2. Calcular el ROI (Return on Investment)
        initial = record.get('initial', 100000.0)
        roi = ((total_capital - initial) / initial) * 100 if initial else 0

        students.append({
            'legajo': legajo,
            'total': round(total_capital, 2),
            'roi': round(roi, 2)
        })

    # Ordenar por ROI descendente
    students.sort(key=lambda s: s['roi'], reverse=True)
    return students

@app.post("/api/trade")
def execute_trade(req: TradeRequest):
    """Ejecuta una orden de compra/venta."""
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
        if user_data['portfolio'][req.asset] < 0.001: # Limpieza de posiciones cerradas
             user_data['portfolio'].pop(req.asset)

    db[req.legajo] = user_data
    save_db(db)
    
    return {"status": "success", "userData": user_data}
    
# ===================== ENDPOINTS AUXILIARES =====================

@app.get("/api/db/{legajo}")
def get_user_data(legajo: str):
    """Obtiene datos de un usuario específico para el login."""
    db = load_db()
    data = db.get(legajo)
    if not data:
        # Crea nuevo usuario si no existe, simulando el comportamiento anterior del JS.
        data = {'balance': 100000.0, 'portfolio': {}, 'initial': 100000.0}
        db[legajo] = data
        save_db(db)
    return data

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mensaje": "El servidor Python está vivo y funcionando"}

# Montar los archivos estáticos (Frontend)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')
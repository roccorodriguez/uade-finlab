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
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import random
import string

app = FastAPI()

DB_FILE = "student_db.json" 
MARKET_CONFIG_FILE = "market_config.json"
METADATA_FILE = "asset_metadata.json"

MARKET_DATA_CACHE = {"data": {}, "timestamp": 0} 
CACHE_DURATION_SECONDS = 5

SYMBOL_EXCEPTIONS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD"
}

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = "uadefinlab.bot@gmail.com"
SENDER_PASSWORD = "abob xxsa zlay iisg"

PENDING_CODES = {}

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
    usuario: str
    asset: str
    quantity: int
    type: str

class StudentRanking(BaseModel):
    usuario: str
    total: float
    roi: float

class AddAssetRequest(BaseModel):
    symbol: str

def load_db():
    if not os.path.exists(DB_FILE):
        initial_db = {}
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
    portfolio_symbols = builtins.set()
    for record in student_db.values():
        portfolio_symbols.update(record['portfolio'].keys())
    
    all_needed_symbols = builtins.set(visible_symbols).union(portfolio_symbols)

    if not all_needed_symbols:
        return {}
        
    yf_tickers_map = {s: get_yahoo_ticker(s) for s in all_needed_symbols}
    tickers_to_download = list(yf_tickers_map.values())
    
    try:
        print(f"⬇ Descargando precios para: {tickers_to_download}")

        data = yf.download(tickers_to_download, period="5d", group_by="ticker", progress=False)
        
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

                history = ticker_data["Close"].dropna().astype(float)

                if history.empty:
                    current_price = 0.0
                    change_percent = 0.0
                else:
                    current_price = float(history.iloc[-1])

                    if len(history) >= 2:
                        pct_series = history.pct_change() * 100
                        change_percent = float(pct_series.iloc[-1])
                    else:
                        change_percent = 0.0

                    if math.isnan(current_price) or math.isinf(current_price): current_price = 0.0
                    if math.isnan(change_percent) or math.isinf(change_percent): change_percent = 0.0

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

# Agregué esta nueva función.
def send_verification_email(to_email: str, code: str):
    # Clave de API desde Render
    api_key = os.getenv("BREVO_API_KEY")
    
    if not api_key:
        print("❌ Error: Falta configurar BREVO_API_KEY")
        return False

    url = "https://api.brevo.com/v3/smtp/email"

    # Datos del correo
    payload = {
        "sender": {
            "name": "FIN LAB bot",
            "email": "uadefinlab.bot@gmail.com" # Tiene que ser el mail que verificaste en Brevo
        },
        "to": [
            {
                "email": to_email,
                "name": "Estudiante UADE"
            }
        ],
        "subject": "Código de Acceso - UADE Fin Lab",
        "htmlContent": f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; text-align: center;">
                <h2 style="color: #333;">Código de Verificación</h2>
                <h1 style="color: #2ebd85; font-size: 48px; letter-spacing: 5px; margin: 20px 0;">{code}</h1>
                <p style="font-size: 12px; color: #999;">Ingrésalo en la terminal.</p>
            </div>
        </div>
        """
    }

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": api_key
    }

    try:
        response = requests.post(url, json=payload, headers=headers)
        
        # Si responde 201 (Creado), salió bien.
        if response.status_code == 201:
            print(f"✅ Email enviado vía Brevo API a {to_email}")
            return True
        else:
            print(f"❌ Error Brevo: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error de conexión API: {e}")
        return False

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
    for uid, record in db.items():
        holdings_value = 0
        
        for symbol, qty in record['portfolio'].items():
            price = current_prices.get(symbol, {}).get("price", 0) 
            holdings_value += qty * price
        
        total_capital = record['balance'] + holdings_value
        
        initial = record.get('initial', 100000.0)
        roi = ((total_capital - initial) / initial) * 100 if initial else 0

        students.append({
            'usuario': uid,
            'total': round(total_capital, 2),
            'roi': round(roi, 2)
        })

    students.sort(key=lambda s: s['roi'], reverse=True)
    return students

@app.post("/api/trade")
def execute_trade(req: TradeRequest):
    db = load_db()
    user_data = db.get(req.usuario)
    
    if not user_data:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
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
        
        # --- CORRECCIÓN: VALIDACIÓN ESTRICTA ---
        # Si la cantidad solicitada es MAYOR a la tenencia, cortamos acá.
        if req.quantity > current_qty:
            raise HTTPException(status_code=400, detail=f"Operación rechazada: Solo tienes {current_qty} acciones de {req.asset}.")
            
        user_data['balance'] += total_cost
        user_data['portfolio'][req.asset] -= req.quantity
        
        # Limpieza de residuos (decimales muy chicos)
        if user_data['portfolio'][req.asset] < 0.001:
             user_data['portfolio'].pop(req.asset)
            
        user_data['balance'] += total_cost
        user_data['portfolio'][req.asset] -= req.quantity
        if user_data['portfolio'][req.asset] < 0.001:
             user_data['portfolio'].pop(req.asset)

    db[req.usuario] = user_data
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

        # 1. VALIDACIÓN Y PRECIO (Usando history directo, no el motor global)
        # Pedimos 5 días para ser consistentes con la lógica del sistema
        history = ticker_obj.history(period="5d")
        
        if history.empty:
            raise Exception("No data found")
            
        # Obtenemos el último cierre válido
        last_close = history["Close"].iloc[-1]
        
        # Si es NaN o 0, rechazamos
        if pd.isna(last_close) or float(last_close) == 0:
             raise HTTPException(status_code=404, detail=f"El activo {symbol} no tiene precio operable.")

        # 2. VALIDAR TIPO DE ACTIVO (Tu restricción de Criptos)
        info = ticker_obj.info
        quote_type = info.get("quoteType", "").upper()
        
        if quote_type == "CRYPTOCURRENCY":
            raise HTTPException(status_code=400, detail="⚠️ Las Criptomonedas están deshabilitadas temporalmente. Solo Acciones.")

        # 3. GUARDAR METADATA
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

        # 4. AGREGAR A LA LISTA
        config.insert(0, symbol)
        save_market_config(config)

        # 5. AHORA SÍ: Forzar actualización del motor global
        # Como ya lo guardamos en el paso 4, ahora el motor sí lo verá
        fetch_yfinance_data(force_update=True)

        return {
            "status": "success",
            "message": f"{symbol} agregado correctamente.",
            "data": metadata[symbol]
        }

    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"❌ Error agregando {symbol}: {e}")
        raise HTTPException(status_code=404, detail=f"No se encontró el activo '{symbol}' o error de conexión.")

@app.delete("/api/market/{symbol}")
def remove_market_asset(symbol: str):
    symbol = symbol.upper()
    config = load_market_config()

    if symbol not in config:
        raise HTTPException(status_code=404, detail="El activo no está en la lista.")

    config.remove(symbol)
    save_market_config(config)

    return {"status": "success", "message": f"{symbol} eliminado de la vista."}
    
@app.get("/api/db/{usuario}")
def get_user_data(usuario: str):
    db = load_db()
    data = db.get(usuario)
    if not data:
        data = {'balance': 100000.0, 'portfolio': {}, 'initial': 100000.0}
        db[usuario] = data
        save_db(db)
    return data

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mensaje": "El servidor Python está vivo y funcionando"}

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

class LoginRequest(BaseModel):
    usuario: str # Ahora usamos usuario UADE (ej: juan.perez), no legajo numérico

class CodeVerification(BaseModel):
    usuario: str
    code: str

# Agregué estos dos nuevos endpoints.
@app.post("/api/auth/request-code")
def request_code(req: LoginRequest):
    """Paso 1: Recibe usuario, genera código y manda mail."""
    usuario = req.usuario.strip().lower()
    
    # Construimos el mail institucional
    email_destino = f"{usuario}@uade.edu.ar"
    
    # Generar código de 6 dígitos
    code = ''.join(random.choices(string.digits, k=6))
    
    # Guardar en memoria (En un sistema real, esto iría a Redis con expiración)
    PENDING_CODES[usuario] = code
    
    print(f"📨 Enviando código {code} a {email_destino}...")
    
    success = send_verification_email(email_destino, code)
    
    if not success:
        raise HTTPException(status_code=500, detail="No se pudo enviar el correo. Verifica tu conexión.")
        
    return {"status": "success", "message": f"Código enviado a {email_destino}"}

@app.post("/api/auth/verify-code")
def verify_code(req: CodeVerification):
    """Paso 2: Verifica el código y loguea al usuario."""
    usuario = req.usuario.strip().lower()
    
    # Verificar si hay un código pendiente
    if usuario not in PENDING_CODES:
        raise HTTPException(status_code=400, detail="No hay solicitud de código para este usuario.")
    
    # Verificar si el código coincide
    if PENDING_CODES[usuario] != req.code:
        raise HTTPException(status_code=400, detail="Código incorrecto.")
    
    # ¡ÉXITO! Borramos el código usado
    del PENDING_CODES[usuario]
    
    # Ahora hacemos lo que hacía antes el 'get_user_data': Cargar o Crear
    db = load_db()
    
    # Usamos el 'usuario' (juan.perez) como ID en la base de datos ahora
    user_data = db.get(usuario)
    
    if not user_data:
        # Usuario nuevo: Regalo de bienvenida
        user_data = {'balance': 100000.0, 'portfolio': {}, 'initial': 100000.0}
        db[usuario] = user_data
        save_db(db)
        
    # Devolvemos los datos del usuario para que el JS inicie la sesión
    return {"status": "success", "userData": user_data, "userId": usuario}
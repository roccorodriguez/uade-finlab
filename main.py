from fastapi import FastAPI, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
from typing import Dict, List, Set, Optional
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
import pymongo
import certifi

from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

MARKET_DATA_CACHE = {"data": {}, "timestamp": 0} 
MARKET_CAP_CACHE = {"data": {}, "timestamp": 0}  # Cache separado para market cap
CACHE_DURATION_SECONDS = 10
MARKET_CAP_CACHE_DURATION = 3600  # Market cap se actualiza cada hora

SYMBOL_EXCEPTIONS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD"
}

PENDING_CODES = {}

class MongoHandler:
    def __init__(self):
        self.MONGO_URI = os.getenv("MONGO_URI")
        if not self.MONGO_URI:
            raise RuntimeError("❌ ERROR: Falta MONGO_URI en .env")

        self.client = pymongo.MongoClient(self.MONGO_URI, tlsCAFile=certifi.where())
        self.db = self.client["finlab_db"]
        self.col_students = self.db["students"]
        self.col_config = self.db["config"]
        self.col_metadata = self.db["metadata"]

        print("✅ Conectado exitosamente a MongoDB Atlas")

    def get_students(self):
        students = {}
        cursor = self.col_students.find({})
        for doc in cursor:
            uid = doc["_id"]
            data = doc.copy()
            del data["_id"]
            students[uid] = data
        return students

    def save_students(self, data_dict):
        for uid, user_data in data_dict.items():
            self.col_students.update_one(
                {"_id": uid}, 
                {"$set": user_data}, 
                upsert=True
            )

    def get_config(self):
        doc = self.col_config.find_one({"_id": "market_config"})
        return doc["symbols"] if doc else ["GGAL", "YPF", "MELI", "BTC", "AAPL"]

    def save_config(self, symbols_list):
        self.col_config.update_one(
            {"_id": "market_config"},
            {"$set": {"symbols": symbols_list}},
            upsert=True
        )

    def get_metadata(self):
        meta = {}
        cursor = self.col_metadata.find({})
        for doc in cursor:
            symbol = doc["_id"]
            data = doc.copy()
            del data["_id"]
            meta[symbol] = data
        return meta

    def save_metadata(self, data_dict):
        for symbol, info in data_dict.items():
            self.col_metadata.update_one(
                {"_id": symbol},
                {"$set": info},
                upsert=True
            )

db_handler = MongoHandler()

class AssetData(BaseModel):
    name: str
    price: float
    change_percent: float
    volatility: float
    sector: str
    market_cap: Optional[float] = None
    previous_close: Optional[float] = None
    open_price: Optional[float] = None
    day_low: Optional[float] = None
    day_high: Optional[float] = None
    fifty_two_week_low: Optional[float] = None
    fifty_two_week_high: Optional[float] = None
    volume: Optional[int] = None
    avg_volume: Optional[int] = None
    pe_ratio: Optional[float] = None
    eps: Optional[float] = None
    earnings_date: Optional[str] = None
    dividend_yield: Optional[str] = None
    ex_dividend_date: Optional[str] = None
    target_est: Optional[float] = None

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
    return db_handler.get_students()

def save_db(db_data):
    db_handler.save_students(db_data)

def load_market_config() -> List[str]:
    config = db_handler.get_config()
    if not config:
        return ["GGAL", "YPF", "MELI", "BTC", "AAPL"] 
    return config

def save_market_config(symbols: List[str]):
    db_handler.save_config(symbols)

def load_metadata() -> Dict:
    return db_handler.get_metadata()

def save_metadata(data: Dict):
    db_handler.save_metadata(data)

def get_yahoo_ticker(symbol: str) -> str:
    return SYMBOL_EXCEPTIONS.get(symbol, symbol)

def format_timestamp_to_date(ts):
    if not ts: return None
    try:
        from datetime import datetime
        return datetime.fromtimestamp(ts).strftime('%b %d, %Y')
    except:
        return None

def fetch_fundamental_data(symbols: List[str], force_update: bool = False) -> Dict[str, Dict]:
    """Obtiene datos fundamentales (más lento pero preciso)"""
    global MARKET_CAP_CACHE
    
    if not force_update and (time.time() - MARKET_CAP_CACHE["timestamp"] < MARKET_CAP_CACHE_DURATION):
        return MARKET_CAP_CACHE["data"]
    
    fundamental_data = {}
    
    for symbol in symbols:
        try:
            yf_ticker = get_yahoo_ticker(symbol)
            ticker = yf.Ticker(yf_ticker)
            info = ticker.info
            
            # Intentar obtener market cap
            market_cap = info.get("marketCap", 0)
            if not market_cap:
                market_cap = info.get("totalAssets", 0)  # Para ETFs
            if not market_cap:
                # Calcular aproximado: precio * shares outstanding
                price = info.get("currentPrice", info.get("regularMarketPrice", 0))
                shares = info.get("sharesOutstanding", 0)
                market_cap = price * shares if price and shares else 1000000000
            
            # Formatear dividend yield
            div_yield_val = info.get("dividendYield")
            div_rate = info.get("dividendRate")
            div_yield_str = None
            if div_yield_val is not None and div_rate is not None:
                div_yield_str = f"{div_rate:.2f} ({div_yield_val*100:.2f}%)"
            
            fundamental_data[symbol] = {
                "market_cap": market_cap,
                "previous_close": info.get("previousClose"),
                "open_price": info.get("open"),
                "day_low": info.get("dayLow"),
                "day_high": info.get("dayHigh"),
                "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
                "volume": info.get("volume"),
                "avg_volume": info.get("averageVolume"),
                "pe_ratio": info.get("trailingPE"),
                "eps": info.get("trailingEps"),
                "earnings_date": format_timestamp_to_date(info.get("earningsTimestamp")),
                "dividend_yield": div_yield_str,
                "ex_dividend_date": format_timestamp_to_date(info.get("exDividendDate")),
                "target_est": info.get("targetMeanPrice")
            }
            
        except Exception as e:
            print(f"⚠️ Error obteniendo datos fundamentales de {symbol}: {e}")
            fundamental_data[symbol] = {"market_cap": 1000000000}  # Default
    
    MARKET_CAP_CACHE["data"] = fundamental_data
    MARKET_CAP_CACHE["timestamp"] = time.time()
    
    return fundamental_data

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
    
    # Obtener datos fundamentales (usa cache de 1 hora)
    fundamental_data = fetch_fundamental_data(list(all_needed_symbols))
    
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
                f_data = fundamental_data.get(symbol, {})

                results[symbol] = {
                    "name": asset_meta.get("name", symbol),
                    "price": round(current_price, 2),
                    "change_percent": round(change_percent, 2),
                    "volatility": asset_meta.get("volatility", 1.0),
                    "sector": asset_meta.get("sector", "General"),
                    "market_cap": f_data.get("market_cap", asset_meta.get("market_cap", 1000000000)),
                    "previous_close": f_data.get("previous_close"),
                    "open_price": f_data.get("open_price"),
                    "day_low": f_data.get("day_low"),
                    "day_high": f_data.get("day_high"),
                    "fifty_two_week_low": f_data.get("fifty_two_week_low"),
                    "fifty_two_week_high": f_data.get("fifty_two_week_high"),
                    "volume": f_data.get("volume"),
                    "avg_volume": f_data.get("avg_volume"),
                    "pe_ratio": f_data.get("pe_ratio"),
                    "eps": f_data.get("eps"),
                    "earnings_date": f_data.get("earnings_date"),
                    "dividend_yield": f_data.get("dividend_yield"),
                    "ex_dividend_date": f_data.get("ex_dividend_date"),
                    "target_est": f_data.get("target_est")
                }
            except Exception as e:
                results[symbol] = {
                    "name": symbol, "price": 0.0, "change_percent": 0.0, 
                    "volatility": 0, "sector": "N/A", "market_cap": 1000000000
                }

        MARKET_DATA_CACHE["data"] = results
        MARKET_DATA_CACHE["timestamp"] = time.time()
        return results
    except Exception as e:
        print(f"Error crítico en YFinance: {e}")
        if MARKET_DATA_CACHE["data"]: return MARKET_DATA_CACHE["data"]
        return {}

def send_verification_email(to_email: str, code: str):
    api_key = os.getenv("BREVO_API_KEY")
    
    if not api_key:
        print(" Error: Falta configurar BREVO_API_KEY")
        return False

    url = "https://api.brevo.com/v3/smtp/email"

    payload = {
        "sender": {
            "name": "FIN LAB bot",
            "email": "uadefinlab.bot@gmail.com"
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

class ChatRequest(BaseModel):
    message: str
    asset: str
    price: str
    sector: str

@app.post("/api/chat")
def chat_with_ai(req: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY no configurada.")

    system_prompt = (
        "Eres un analista financiero experto y conciso. "
        "SOLO respondés preguntas estrictamente relacionadas con finanzas, mercados, acciones, economía o el activo en contexto. "
        "Si la pregunta no es financiera, respondé únicamente: 'Solo respondo consultas financieras.' "
        "Siempre respondé en UN solo párrafo, sin listas ni bullets. Sé breve y directo."
    )
    prompt = f"{system_prompt}\n\nContexto del activo: {req.asset} cotiza a {req.price} USD en el sector {req.sector}.\n\nPregunta del usuario: {req.message}"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemma-3-12b-it:generateContent?key={api_key}"
    payload = {"contents": [{"parts": [{"text": prompt}]}]}

    try:
        response = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        data = response.json()
        ai_text = data["candidates"][0]["content"]["parts"][0]["text"]
        return {"reply": ai_text}
    except Exception as e:
        print(f"❌ Error Gemini API: {e}")
        raise HTTPException(status_code=500, detail="Error al conectar con la IA.")

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
        
        if req.quantity > current_qty:
            raise HTTPException(status_code=400, detail=f"Operación rechazada: Solo tienes {current_qty} acciones de {req.asset}.")
            
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

        history = ticker_obj.history(period="5d")
        
        if history.empty:
            raise Exception("No data found")
            
        last_close = history["Close"].iloc[-1]
        
        if pd.isna(last_close) or float(last_close) == 0:
             raise HTTPException(status_code=404, detail=f"El activo {symbol} no tiene precio operable.")

        info = ticker_obj.info
        quote_type = info.get("quoteType", "").upper()
        
        if quote_type == "CRYPTOCURRENCY":
            raise HTTPException(status_code=400, detail="⚠️ Las Criptomonedas están deshabilitadas temporalmente. Solo Acciones.")

        # Obtener market cap
        market_cap = info.get("marketCap", 0)
        if not market_cap:
            market_cap = info.get("totalAssets", 0)
        if not market_cap:
            price = info.get("currentPrice", info.get("regularMarketPrice", 0))
            shares = info.get("sharesOutstanding", 0)
            market_cap = price * shares if price and shares else 1000000000

        asset_name = info.get("shortName", info.get("longName", symbol))
        asset_sector = info.get("sector", "General")
        asset_volatility = info.get("beta", 1.0)
        if asset_volatility is None: asset_volatility = 1.0

        metadata[symbol] = {
            "name": asset_name,
            "sector": asset_sector,
            "volatility": asset_volatility,
            "market_cap": market_cap
        }
        save_metadata(metadata)

        config.insert(0, symbol)
        save_market_config(config)

        # Actualizar cache de market cap
        global MARKET_CAP_CACHE
        MARKET_CAP_CACHE["data"][symbol] = market_cap

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

COPA_PASSWORD = "COPAFINLABS2026"

class ResetCopaRequest(BaseModel):
    password: str
    end_date: str  # ISO format

@app.get("/api/copa-config")
def get_copa_config():
    doc = db_handler.col_config.find_one({"_id": "copa_config"})
    if doc and "end_date" in doc:
        return {"end_date": doc["end_date"]}
    return {"end_date": "2026-01-27T00:00:00"}

@app.post("/api/reset-copa")
def reset_copa(req: ResetCopaRequest):
    if req.password != COPA_PASSWORD:
        raise HTTPException(status_code=403, detail="Contraseña incorrecta.")

    result = db_handler.col_students.delete_many({})
    print(f"🗑️ Copa reiniciada: {result.deleted_count} alumnos eliminados.")

    db_handler.col_config.update_one(
        {"_id": "copa_config"},
        {"$set": {"end_date": req.end_date}},
        upsert=True
    )

    return {"status": "success", "end_date": req.end_date}

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mensaje": "El servidor Python está vivo y funcionando"}

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

class LoginRequest(BaseModel):
    usuario: str

class CodeVerification(BaseModel):
    usuario: str
    code: str

@app.post("/api/auth/request-code")
def request_code(req: LoginRequest):
    usuario = req.usuario.strip().lower()
    email_destino = f"{usuario}@uade.edu.ar"
    code = ''.join(random.choices(string.digits, k=6))
    PENDING_CODES[usuario] = code
    
    print(f"📨 Enviando código {code} a {email_destino}...")
    
    success = send_verification_email(email_destino, code)
    
    if not success:
        raise HTTPException(status_code=500, detail="No se pudo enviar el correo. Verifica tu conexión.")
        
    return {"status": "success", "message": f"Código enviado a {email_destino}"}

@app.post("/api/auth/verify-code")
def verify_code(req: CodeVerification):
    usuario = req.usuario.strip().lower()
    
    if usuario not in PENDING_CODES:
        raise HTTPException(status_code=400, detail="No hay solicitud de código para este usuario.")
    
    if PENDING_CODES[usuario] != req.code:
        raise HTTPException(status_code=400, detail="Código incorrecto.")
    
    del PENDING_CODES[usuario]
    
    db = load_db()
    user_data = db.get(usuario)
    
    if not user_data:
        user_data = {'balance': 100000.0, 'portfolio': {}, 'initial': 100000.0}
        db[usuario] = user_data
        save_db(db)
        
    return {"status": "success", "userData": user_data, "userId": usuario}

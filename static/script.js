// ================= CONFIGURACIÓN =================
const API_KEY = "AIzaSyBpOSQq5DnU_0wfxPWb8uPZt0U8LHJhjeM"; 
const INITIAL_CAPITAL = 100000;
const STUDENT_DB_URL = '/api/db/'; 

// Catálogo Central: Ahora es solo metadata (nombre, sector)
const AVAILABLE_ASSETS = {
    GGAL: { name: 'Grupo Galicia', sector: 'Financiero', tvSymbol: 'NASDAQ:GGAL' },
    YPFD: { name: 'YPF S.A.', sector: 'Energía', tvSymbol: 'NYSE:YPF' },
    MELI: { name: 'Mercado Libre', sector: 'E-Commerce', tvSymbol: 'NASDAQ:MELI' },
    MSFT: { name: 'Microsoft', sector: 'Tecnología', tvSymbol: 'NASDAQ:MSFT' },
    AAPL: { name: 'Apple Inc.', sector: 'Tecnología', tvSymbol: 'NASDAQ:AAPL' },
    TSLA: { name: 'Tesla', sector: 'Automotriz', tvSymbol: 'NASDAQ:TSLA' },
    BTC:  { name: 'Bitcoin', sector: 'Cripto', tvSymbol: 'BINANCE:BTCUSDT' }
};

// Nueva variable global para almacenar los precios en tiempo real del backend
let realTimePrices = {}; 

let currentAsset = 'GGAL';
let currentUser = null;
let db = {}; // Almacena temporalmente los datos del alumno logueado
let chatHistory = {};

// Fecha de cierre de la competencia (27 Enero 2026)
const countDownDate = new Date("Jan 27, 2026 00:00:00").getTime();

// ================= INICIALIZACIÓN Y BUCLE PRINCIPAL =================
document.addEventListener('DOMContentLoaded', () => {
    // Inicializa el sistema y carga todo del backend
    initializeApp(); 
    
    // Loop principal: Actualiza precios y ranking cada 10 segundos
    setInterval(fetchMarketDataAndLeaderboard, 10000); 
    // Mantenemos el timer en 1s
    setInterval(updateTimer, 1000); 
});

async function initializeApp() {
    try {
        // Cargar todos los precios y el ranking
        await fetchMarketDataAndLeaderboard();
        
        // Esto solo carga el portafolio del usuario actual
        loadUserDataFromBackend(); 
        
        renderAssetList();
        loadAsset('GGAL');
        
    } catch (e) {
        showToast('❌ Error crítico al iniciar el sistema.', 'error');
        console.error("Error al inicializar la app:", e);
    }
}

// ================= FUNCIÓN DE ACTUALIZACIÓN (Reemplaza updateMarketPrices y renderLeaderboard) =================

async function fetchMarketDataAndLeaderboard() {
    try {
        // Pedimos al backend los datos de mercado y el ranking ya calculado.
        const [marketResponse, leaderboardResponse] = await Promise.all([
            fetch('/api/market-data'),
            fetch('/api/leaderboard')
        ]);

        const marketData = await marketResponse.json();
        const leaderboardData = await leaderboardResponse.json();

        // 1. Guardamos el nuevo catálogo global de precios (el caché JS)
        realTimePrices = marketData; 
        
        // 2. Dibujamos la lista de activos con los precios reales
        renderAssetList(); 
        
        // 3. Dibujamos el ranking
        renderLeaderboard(leaderboardData); 
        
        // 4. Actualizamos la interfaz del usuario si está logueado
        if (currentUser) updateUIForUser(true); 

    } catch (error) {
        showToast('⚠️ No se pudieron cargar los precios en tiempo real. Revisar Uvicorn.', 'error');
        console.error("Error fetching market data:", error);
    }
}

// ================= TIMER =================
function updateTimer() {
    const now = new Date().getTime();
    const distance = countDownDate - now;

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    document.getElementById("competitionTimer").innerHTML = 
        (days < 10 ? "0" + days : days) + "d " + 
        (hours < 10 ? "0" + hours : hours) + "h " + 
        (minutes < 10 ? "0" + minutes : minutes) + "m " + 
        (seconds < 10 ? "0" + seconds : seconds) + "s ";

    if (distance < 0) {
        document.getElementById("competitionTimer").innerHTML = "FINALIZADO";
    }
}

// ================= NAV & WIDGET LOGIC =================
function switchTab(id, tab) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    tab.classList.add('active');
}

// ================= DATABASE / AUTH =================
// Eliminamos loadDB() y saveDB()

async function loadUserDataFromBackend() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${STUDENT_DB_URL}${currentUser.legajo}`);
        if (response.ok) {
            const userData = await response.json();
            // Actualizamos la DB local y el usuario actual con los datos del backend
            db[currentUser.legajo] = userData;
            currentUser = { legajo: currentUser.legajo, ...userData };
            updateUIForUser();
        }
    } catch (e) {
        showToast('⚠️ Error al cargar datos del alumno.', 'error');
    }
}

function studentLogin() {
    const legajo = document.getElementById('legajoInput').value.trim();
    if (!legajo) return showToast('⚠️ Ingresa un número de legajo', 'error');

    // Aquí ya no creamos el usuario; el backend lo crea si no existe (ver /api/db/{legajo} en main.py)
    currentUser = { legajo }; 
    loadUserDataFromBackend();

    document.getElementById('loginPanel').style.display = 'none';
    document.getElementById('tradingPanel').classList.add('active');
}

function studentLogout() {
    currentUser = null;
    document.getElementById('legajoInput').value = '';
    document.getElementById('tradingPanel').classList.remove('active');
    document.getElementById('loginPanel').style.display = 'flex';
}

// ================= TRADING LOGIC =================
function updateUIForUser(pricesUpdated = false) {
    if (!currentUser) return;

    const userData = db[currentUser.legajo];
    document.getElementById('userLegajo').innerText = currentUser.legajo;
    document.getElementById('userBalance').innerText = formatMoney(userData.balance);
    document.getElementById('orderAsset').innerText = currentAsset;
    
    // Obtenemos el precio del caché de precios en tiempo real
    const currentPrice = realTimePrices[currentAsset] ? realTimePrices[currentAsset].price : 0.00;
    document.getElementById('orderPrice').innerText = formatMoney(currentPrice);

    // Renderizar portafolio (Usa realTimePrices para calcular valor)
    const list = document.getElementById('holdingsList');
    list.innerHTML = '';
    const entries = Object.entries(userData.portfolio);
    if(entries.length === 0) list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Sin activos</div>';
    else {
        entries.forEach(([symbol, qty]) => {
            if (qty > 0) {
                // Buscamos el precio en el caché de tiempo real
                const assetPrice = realTimePrices[symbol] ? realTimePrices[symbol].price : 0;
                const totalVal = qty * assetPrice;
                list.innerHTML += `<div class="holding-item"><div><strong style="color:#fff">${symbol}</strong> <span style="color:#aaa">(${qty})</span></div><div>${formatMoney(totalVal)}</div></div>`;
            }
        });
    }
    
    if(pricesUpdated) showToast('Precios actualizados', 'info');
}

async function executeOrder(type) {
    const qty = parseInt(document.getElementById('orderQty').value);
    if (!qty || qty <= 0) return showToast('Cantidad inválida', 'error');

    const tradeData = {
        legajo: currentUser.legajo,
        asset: currentAsset,
        quantity: qty,
        type: type // 'buy' o 'sell'
    };

    try {
        const response = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tradeData)
        });
        const result = await response.json();

        if (response.ok) {
            db[currentUser.legajo] = result.userData;
            currentUser.balance = result.userData.balance; 
            
            showToast(`✅ ${type === 'buy' ? 'Compra' : 'Venta'} Exitosa`, 'success');
            addToFeed(currentUser.legajo, currentAsset, type.toUpperCase(), qty);
            
            // Recargamos datos y ranking inmediatamente después del trade
            await fetchMarketDataAndLeaderboard(); 

        } else {
            showToast(`❌ ${result.detail || 'Error en la operación'}`, 'error');
        }

    } catch (error) {
        showToast('❌ Error de conexión con el servidor de trading', 'error');
    }
}

// ================= COMPETITION FEATURES =================
function addToFeed(legajo, symbol, type, qty) {
    const feed = document.getElementById('marketFeed');
    const item = document.createElement('div');
    const isBuy = type === 'BUY';
    item.className = `feed-item ${isBuy ? 'feed-buy' : 'feed-sell'}`;
    
    item.innerHTML = `
        <span><strong>#${legajo}</strong> ${isBuy ? 'compró' : 'vendió'} <strong>${symbol}</strong></span>
        <span>${qty} un.</span>
    `;
    
    feed.insertBefore(item, feed.firstChild);
    if(feed.children.length > 8) feed.lastChild.remove();
}

// Reemplaza la función renderLeaderboard
function renderLeaderboard(students) {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';

    students.slice(0, 8).forEach((s, index) => { 
        let rankClass = 'rank-other';
        let rankIcon = index + 1;
        if(index === 0) { rankClass = 'rank-1'; rankIcon = '♛'; }
        if(index === 1) rankClass = 'rank-2'; 
        if(index === 2) rankClass = 'rank-3'; 
        
        const roiClass = s.roi >= 0 ? 'roi-positive' : 'roi-negative';
        const rowBg = (currentUser && currentUser.legajo === s.legajo) ? 'background: rgba(255, 255, 255, 0.05);' : '';

        tbody.innerHTML += `
            <tr style="${rowBg}">
                <td><div class="rank-badge ${rankClass}">${rankIcon}</div></td>
                <td style="font-family:'JetBrains Mono'; color:#fff;">${s.legajo}</td>
                <td style="text-align:right; font-family:'JetBrains Mono'">${formatMoney(s.total)}</td>
                <td style="text-align:right" class="${roiClass}">${s.roi >=0 ? '+' : ''}${s.roi.toFixed(2)}%</td>
            </tr>
        `;
    });
}

// ================= GENERAL UI =================

// script.js - Reemplaza renderAssetList

function renderAssetList() {
    const container = document.getElementById('assetList');
    container.innerHTML = '';
    
    if (Object.keys(realTimePrices).length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#555; font-size:12px;">Cargando mercado...</div>';
        return;
    }

    const symbols = Object.keys(AVAILABLE_ASSETS).reverse(); 

    symbols.forEach(symbol => {
        const d = AVAILABLE_ASSETS[symbol];
        const p = realTimePrices[symbol] || {price: 0.00, change_percent: 0.00};
        
        const activeClass = symbol === currentAsset ? 'active' : '';
        const priceClass = p.change_percent >= 0 ? 'positive' : 'negative';

        const trashIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        // ORDEN NUEVO: Info | Botón | Precio
        container.innerHTML += `
            <div class="asset-item ${activeClass}" onclick="loadAsset('${symbol}')">
                
                <div style="overflow: hidden;">
                    <div class="asset-symbol" style="color: #fff;">${symbol}</div>
                    <div class="asset-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</div>
                </div>

                <button class="btn-remove" onclick="event.stopPropagation(); removeAsset('${symbol}')" title="Eliminar">
                    ${trashIcon}
                </button>

                <div class="asset-price-mini ${priceClass}">
                    $${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits:2})}
                </div>

            </div>
        `;
    });
}

// ================= NUEVO: TRADINGVIEW LOGIC =================
function loadTradingViewChart(symbolKey) {
    const symbol = AVAILABLE_ASSETS[symbolKey].tvSymbol || 'NASDAQ:AAPL';
    
    if (document.getElementById('tv_chart_container')) {
        document.getElementById('tv_chart_container').innerHTML = ''; 
        
        new TradingView.widget({
            "autosize": true,
            "symbol": symbol,
            "interval": "D",
            "timezone": "America/Argentina/Buenos_Aires",
            "theme": "dark",
            "style": "1",
            "locale": "es",
            "toolbar_bg": "#161616", // Ajustado para que TradingView respete el color
            "enable_publishing": false,
            "hide_top_toolbar": false,
            "hide_legend": false,
            "save_image": false,
            "container_id": "tv_chart_container",
            "backgroundColor": "#161616", 
            "gridColor": "rgba(255, 255, 255, 0.05)"
        });
    }
}

function loadAsset(symbol) {
    currentAsset = symbol;
    
    const data = AVAILABLE_ASSETS[symbol];
    const prices = realTimePrices[symbol] || { sector: data.sector, volatility: 0 };

    if(document.getElementById('metaName')) document.getElementById('metaName').innerText = data.name;
    if(document.getElementById('metaSector')) document.getElementById('metaSector').innerText = prices.sector || data.sector;
    // Usamos el beta de YFinance como proxy de volatilidad
    if(document.getElementById('metaVol')) document.getElementById('metaVol').innerText = (prices.volatility * 100).toFixed(1) + '%';
    if(document.getElementById('chat-context-asset')) document.getElementById('chat-context-asset').innerText = symbol;
    
    const targets = ['Strong Buy', 'Hold', 'Sell', 'Accumulate'];
    if(document.getElementById('metaTarget')) document.getElementById('metaTarget').innerText = targets[Math.floor(Math.random()*targets.length)];

    renderAssetList();
    if(currentUser) updateUIForUser();
    
    loadTradingViewChart(symbol);
    renderChat(symbol); 
}

function formatMoney(num) {
    return '$' + num.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function showToast(msg, type) {
    const x = document.getElementById("toast");
    x.innerText = msg;
    x.style.borderLeft = `5px solid ${type === 'error' ? 'var(--danger)' : 'var(--success)'}`;
    x.className = "show";
    setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
}

// ================= CHATBOT =================
const chatbox = document.querySelector(".chatbox");
const chatInput = document.querySelector(".chat-input textarea");
const sendChatBtn = document.querySelector(".chat-input span");

const createChatLi = (message, className) => {
    const chatLi = document.createElement("li");
    chatLi.classList.add("chat", className);
    let chatContent = className === "outgoing" ? `<p></p>` : `<span>🤖</span><p></p>`;
    chatLi.innerHTML = chatContent;
    chatLi.querySelector("p").textContent = message;
    return chatLi;
}

// Función para renderizar el chat guardado o iniciar uno nuevo
function renderChat(symbol) {
    chatbox.innerHTML = ''; 
    
    if (!chatHistory[symbol]) {
        chatHistory[symbol] = [
            { role: 'incoming', text: `Hola. Estoy analizando el gráfico de ${symbol}. ¿En qué te puedo ayudar?` }
        ];
    }

    chatHistory[symbol].forEach(msg => {
        const li = createChatLi(msg.text, msg.role);
        chatbox.appendChild(li);
    });
    chatbox.scrollTo(0, chatbox.scrollHeight);
}

const generateResponse = async (chatElement) => {
    const messageElement = chatElement.querySelector("p");
    const price = realTimePrices[currentAsset] ? realTimePrices[currentAsset].price : 'N/A';
    
    const context = `Activo: ${currentAsset}, Precio: ${price}, Sector: ${realTimePrices[currentAsset].sector}. Eres un experto financiero. Responde brevemente.`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: `Contexto: ${context}. User says: ${chatInput.value}` }] }] }),
        });
        const data = await response.json();
        const aiText = data.candidates[0].content.parts[0].text;
        messageElement.textContent = aiText;
        
        chatHistory[currentAsset].push({ role: 'incoming', text: aiText });
        
    } catch (error) { messageElement.textContent = "Error de conexión con AI."; }
};

const handleChat = () => {
    const userMessage = chatInput.value.trim();
    if (!userMessage) return;
    
    chatHistory[currentAsset].push({ role: 'outgoing', text: userMessage });

    chatInput.value = "";
    chatbox.appendChild(createChatLi(userMessage, "outgoing"));
    chatbox.scrollTo(0, chatbox.scrollHeight);

    setTimeout(() => {
        const incomingChatLi = createChatLi("Pensando...", "incoming");
        chatbox.appendChild(incomingChatLi);
        chatbox.scrollTo(0, chatbox.scrollHeight);
        generateResponse(incomingChatLi);
    }, 600);
}
sendChatBtn.addEventListener("click", handleChat);

// ================= AGREGAR/ELIMINAR ASSETS =================

function handleEnter(e) {
    if (e.key === 'Enter') addNewAsset();
}

async function addNewAsset() {
    const input = document.getElementById('newAssetInput');
    const symbol = input.value.trim().toUpperCase();

    if (!symbol) return showToast('⚠️ Escribe un símbolo', 'error');
    if (AVAILABLE_ASSETS[symbol]) return showToast('⚠️ El activo ya está en la lista', 'error');

    // NOTA: Para que este activo se agregue con precio REAL, debe ser agregado 
    // a la lista 'TICKER_MAP' en main.py y el servidor debe reiniciarse.
    // Por ahora, solo lo agregamos al frontend para la UI.
    
    const btn = document.querySelector('.search-container button');
    const originalText = btn.innerText;
    btn.innerText = "⌛";

    try {
        // SIMULACIÓN DE DATA MÍNIMA (para que no falle la UI)
        AVAILABLE_ASSETS[symbol] = {
            name: `${symbol} (No Verif.)`,
            sector: 'General',
            tvSymbol: `NASDAQ:${symbol}`
        };

        renderAssetList();
        
        showToast(`✅ ${symbol} agregado al mercado (sin precio real aún).`, 'success');
        input.value = '';
        
        loadAsset(symbol);

    } catch (error) {
        showToast('❌ Error al agregar activo', 'error');
    } finally {
        btn.innerText = originalText;
    }
}

function removeAsset(symbol) {
    const holdings = currentUser ? (db[currentUser.legajo].portfolio[symbol] || 0) : 0;
    
    if (holdings > 0) {
        return showToast(`❌ Error: Debes vender las ${holdings} acciones de ${symbol} primero.`, 'error');
    }
    
    if (symbol === currentAsset) {
         loadAsset('GGAL'); 
    }
    
    // NOTA: Para que el activo se deje de monitorear en el backend,
    // también debe ser removido de la lista 'ACTIVE_SYMBOLS' en main.py.
    delete AVAILABLE_ASSETS[symbol];
    
    showToast(`🗑️ ${symbol} eliminado de la pila de mercado.`, 'success');
    renderAssetList(); 
}
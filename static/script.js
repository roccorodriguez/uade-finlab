const API_KEY = "AIzaSyBpOSQq5DnU_0wfxPWb8uPZt0U8LHJhjeM"; 
const INITIAL_CAPITAL = 100000;
const STUDENT_DB_URL = '/api/db/';

let realTimePrices = {}; 
let currentAsset = 'NVDA';
let currentUser = null;
let db = {};
let chatHistory = {};

const countDownDate = new Date("Jan 27, 2026 00:00:00").getTime();

document.addEventListener('DOMContentLoaded', () => {
    initializeApp(); 
    
    setInterval(fetchMarketDataAndLeaderboard, 5000); 
    setInterval(updateTimer, 1000); 
});

async function initializeApp() {
    try {
        await fetchMarketDataAndLeaderboard();
        
        loadUserDataFromBackend(); 
        
        renderAssetList();
        loadAsset('NVDA');
        
    } catch (e) {
        showToast('❌ Error crítico al iniciar el sistema.', 'error');
        console.error("Error al inicializar la app:", e);
    }
}

async function fetchMarketDataAndLeaderboard() {
    try {
        const [marketResponse, leaderboardResponse] = await Promise.all([
            fetch('/api/market-data'),
            fetch('/api/leaderboard')
        ]);

        const marketData = await marketResponse.json();
        const leaderboardData = await leaderboardResponse.json();

        realTimePrices = marketData; 
        
        renderAssetList();
        
        renderLeaderboard(leaderboardData); 
        
        if (currentUser) updateUIForUser(true); 

    } catch (error) {
        showToast('⚠️ No se pudieron cargar los precios en tiempo real.', 'error');
        console.error("Error fetching market data:", error);
    }
}

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

function switchTab(id, tab) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    tab.classList.add('active');
}

async function loadUserDataFromBackend() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${STUDENT_DB_URL}${currentUser.legajo}`);
        if (response.ok) {
            const userData = await response.json();
            db[currentUser.legajo] = userData;
            currentUser = { legajo: currentUser.legajo, ...userData };
            updateUIForUser();
        }
    } catch (e) {
        showToast('⚠️ Error al cargar datos del alumno.', 'error');
    }
}

// De acá hasta studentlogout.
// Variable de estado para saber si estamos en el paso 1 o 2
let isWaitingForCode = false;
let tempUsername = ""; // Guardamos el usuario mientras escribe el código

function handleLoginEnter(e) {
    if (e.key === 'Enter') handleLoginStep();
}

async function handleLoginStep() {
    const input = document.getElementById('loginInput');
    const val = input.value.trim();
    const btn = document.getElementById('loginBtn');

    if (!val) return showToast('⚠️ Campo vacío', 'error');

    // === PASO 1: PEDIR CÓDIGO ===
    if (!isWaitingForCode) {
        tempUsername = val; // Guardamos "juan.perez"
        
        btn.innerText = "Enviando...";
        input.disabled = true;

        try {
            const response = await fetch('/api/auth/request-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: tempUsername })
            });
            
            const result = await response.json();

            if (response.ok) {
                // Cambiar la interfaz al Modo "Ingresar Código"
                isWaitingForCode = true;
                
                showToast(`📧 ${result.message}`, 'success');
                
                // Actualizar UI
                document.getElementById('loginTitle').innerText = "Verificar Identidad";
                document.getElementById('loginSubtitle').innerText = `Ingresa el código enviado a ${tempUsername}@uade.edu.ar`;
                input.value = ""; // Limpiar para que ponga el código
                input.placeholder = "Código de 6 dígitos";
                input.type = "number"; // Teclado numérico en celular
                input.disabled = false;
                input.focus();
                
                btn.innerText = "Verificar e Ingresar";
                document.getElementById('loginFooter').innerHTML = `<a href="#" onclick="resetLogin()" style="color:#666">¿Te equivocaste de usuario? Volver</a>`;

            } else {
                showToast(`❌ ${result.detail}`, 'error');
                btn.innerText = "Enviar Código";
                input.disabled = false;
            }
        } catch (e) {
            showToast('❌ Error de conexión', 'error');
            btn.innerText = "Enviar Código";
            input.disabled = false;
        }

    // === PASO 2: VERIFICAR CÓDIGO ===
    } else {
        const code = val;
        btn.innerText = "Verificando...";
        
        try {
            const response = await fetch('/api/auth/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: tempUsername, code: code })
            });
            
            const result = await response.json();

            if (response.ok) {
                // ¡LOGIN EXITOSO!
                // Guardamos los datos recibidos
                currentUser = { usuario: result.userId, ...result.userData };
                db[currentUser.usuario] = result.userData; // Actualizamos caché local
                
                updateUIForUser();
                
                // Transición de pantalla
                document.getElementById('loginPanel').style.display = 'none';
                document.getElementById('tradingPanel').classList.add('active');
                showToast('🚀 Sesión iniciada correctamente', 'success');
                
                // Limpiar estado por si desloguea
                resetLoginVariables();

            } else {
                showToast(`❌ ${result.detail}`, 'error');
                btn.innerText = "Verificar e Ingresar";
            }
        } catch (e) {
            showToast('❌ Error al verificar', 'error');
            btn.innerText = "Verificar e Ingresar";
        }
    }
}

function resetLogin() {
    isWaitingForCode = false;
    tempUsername = "";
    
    const input = document.getElementById('loginInput');
    input.value = "";
    input.placeholder = "Ej: juan.perez";
    input.type = "text";
    input.disabled = false;
    
    document.getElementById('loginTitle').innerText = "Acceso Alumno";
    document.getElementById('loginSubtitle').innerText = "Ingresa tu usuario UADE (sin @uade.edu.ar)";
    document.getElementById('loginBtn').innerText = "Enviar Código";
    document.getElementById('loginFooter').innerText = "Se enviará un código de verificación a tu mail institucional.";
}

function resetLoginVariables() {
    isWaitingForCode = false;
    tempUsername = "";
}

// Actualiza también la función studentLogout para resetear la UI
function studentLogout() {
    currentUser = null;
    resetLogin(); // Restauramos el panel de login al estado inicial
    document.getElementById('tradingPanel').classList.remove('active');
    document.getElementById('loginPanel').style.display = 'flex';
}

function updateUIForUser() {
    if (!currentUser) return;

    const userData = db[currentUser.usuario];
    document.getElementById('userLegajo').innerText = currentUser.usuario;
    document.getElementById('userBalance').innerText = formatMoney(userData.balance);
    document.getElementById('orderAsset').innerText = currentAsset;
    
    const currentPrice = realTimePrices[currentAsset] ? realTimePrices[currentAsset].price : 0.00;
    document.getElementById('orderPrice').innerText = formatMoney(currentPrice);

    const list = document.getElementById('holdingsList');
    list.innerHTML = '';
    const entries = Object.entries(userData.portfolio);
    if(entries.length === 0) list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Sin activos</div>';
    else {
        entries.forEach(([symbol, qty]) => {
            if (qty > 0) {
                const assetPrice = realTimePrices[symbol] ? realTimePrices[symbol].price : 0;
                const totalVal = qty * assetPrice;
                list.innerHTML += `<div class="holding-item"><div><strong style="color:#fff">${symbol}</strong> <span style="color:#aaa">(${qty})</span></div><div>${formatMoney(totalVal)}</div></div>`;
            }
        });
    }
}

async function executeOrder(type) {
    const qty = parseInt(document.getElementById('orderQty').value);
    if (!qty || qty <= 0) return showToast('Cantidad inválida', 'error');

    const tradeData = {
        usuario: currentUser.usuario,
        asset: currentAsset,
        quantity: qty,
        type: type
    };

    try {
        const response = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tradeData)
        });
        const result = await response.json();

        if (response.ok) {
            db[currentUser.usuario] = result.userData;
            currentUser.balance = result.userData.balance; 
            
            showToast(`✅ ${type === 'buy' ? 'Compra' : 'Venta'} Exitosa`, 'success');
            addToFeed(currentUser.usuario, currentAsset, type.toUpperCase(), qty);
            
            await fetchMarketDataAndLeaderboard(); 

        } else {
            showToast(`❌ ${result.detail || 'Error en la operación'}`, 'error');
        }

    } catch (error) {
        showToast('❌ Error de conexión con el servidor de trading', 'error');
    }
}

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
        const rowBg = (currentUser && currentUser.usuario === s.usuario) ? 'background: rgba(255, 255, 255, 0.05);' : '';

        tbody.innerHTML += `
            <tr style="${rowBg}">
                <td><div class="rank-badge ${rankClass}">${rankIcon}</div></td>
                <td style="font-family:'JetBrains Mono'; color:#fff;">${s.usuario}</td>
                <td style="text-align:right; font-family:'JetBrains Mono'">${formatMoney(s.total)}</td>
                <td style="text-align:right" class="${roiClass}">${s.roi >=0 ? '+' : ''}${s.roi.toFixed(2)}%</td>
            </tr>
        `;
    });
}

function renderAssetList() {
    const container = document.getElementById('assetList');
    container.innerHTML = '';

    const symbols = Object.keys(realTimePrices);

    if (symbols.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#555; font-size:12px;">Mercado vacío o cargando...<br>Agrega un activo con el botón +</div>';
        return;
    }

    symbols.forEach(symbol => {
        const p = realTimePrices[symbol];

        if (!p) return;

        const activeClass = symbol === currentAsset ? 'active' : '';
        const priceClass = p.change_percent >= 0 ? 'positive' : 'negative';
        const sign = p.change_percent > 0 ? '+': '';

        const trashIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        container.innerHTML += `
            <div class="asset-item ${activeClass}" onclick="loadAsset('${symbol}')">
                
                <div style="overflow: hidden;">
                    <div class="asset-symbol" style="color: #fff;">${symbol}</div>
                    <div class="asset-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name || symbol}</div>
                </div>

                <button class="btn-remove" onclick="event.stopPropagation(); removeAsset('${symbol}')" title="Eliminar">
                    ${trashIcon}
                </button>

                <div class="asset-price-mini">
                    $${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits:2})}
                </div>

                <div class="asset-change-mini ${priceClass}">
                    ${sign}${p.change_percent.toFixed(2)}%
                </div>

            </div>
        `;
    });
}

function loadTradingViewChart(symbol) {
    // 1. Por defecto: Usamos el símbolo limpio.
    // TradingView es inteligente y encontrará KO en NYSE o MSFT en NASDAQ automáticamente.
    let tvSymbol = symbol;

    // 2. Excepción Berkshire Hathaway (El ticker 'BRK' no existe, es BRK.B)
    if (symbol === 'BRK') {
        tvSymbol = 'NYSE:BRK.B';
    }
    // 3. Excepciones Argentinas (ADRs): Forzamos mercado USA para ver DÓLARES
    // Si no hacemos esto, a veces carga el gráfico de Buenos Aires en Pesos.
    else if (['GGAL', 'MELI'].includes(symbol)) {
        tvSymbol = `NASDAQ:${symbol}`;
    }
    else if (['YPF', 'BMA', 'EDN', 'PAM', 'LOMA', 'TECO2', 'CRESY', 'IRS', 'TGS'].includes(symbol)) {
        tvSymbol = `NYSE:${symbol}`;
    }
        
    if (document.getElementById("tv_chart_container")) {
        document.getElementById("tv_chart_container").innerHTML = '';

        new TradingView.widget({
            "autosize": true,
            "symbol": tvSymbol, 
            "interval": "D",
            "timezone": "America/Argentina/Buenos_Aires",
            "theme": "dark",
            "style": "1",
            "locale": "es",
            "toolbar_bg": "#161616",
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
    // Fallback si no hay precios
    if (!realTimePrices[symbol] && Object.keys(realTimePrices).length > 0) {
        symbol = Object.keys(realTimePrices)[0];
    }
    
    currentAsset = symbol;
    const data = realTimePrices[symbol] || { name: symbol, sector: 'General', volatility: 0 };

    // Actualizar Textos
    if(document.getElementById('metaName')) document.getElementById('metaName').innerText = data.name;
    if(document.getElementById('metaSector')) document.getElementById('metaSector').innerText = data.sector;
    if(document.getElementById('metaVol')) document.getElementById('metaVol').innerText = (data.volatility * 100).toFixed(1) + '%';
    if(document.getElementById('chat-context-asset')) document.getElementById('chat-context-asset').innerText = symbol;
    
    // --- NUEVA LÓGICA DEL BOTÓN ---
    const btnTv = document.getElementById('btnTradingView');
    if (btnTv) {
        // Corrección para Berkshire Hathaway
        let searchSymbol = symbol;
        if (symbol === 'BRK') searchSymbol = 'BRK.B';
        
        // Generamos el link de búsqueda de TradingView
        btnTv.href = `https://es.tradingview.com/symbols/${searchSymbol}/`;
    }
    // ------------------------------

    renderAssetList();
    if(currentUser) updateUIForUser();
    
    loadTradingViewChart(symbol);
    renderChat(symbol); 
}

async function addNewAsset() {
    const input = document.getElementById('newAssetInput');
    const symbol = input.value.trim().toUpperCase();

    if (!symbol) return showToast('⚠️ Escribe un símbolo', 'error');

    const btn = document.querySelector('.search-container button');
    const originalText = btn.innerText;
    btn.innerText = "⌛";

    try {
        const response = await fetch("/api/market/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: symbol })
        });

        const result = await response.json();

        if (response.ok) {
            showToast(`✅ ${symbol} agregado correctamente.`, 'success');
            input.value = '';

            await fetchMarketDataAndLeaderboard();

            loadAsset(symbol);
        } else {
            showToast(`❌ ${result.detail || 'Error al agregar'}`, 'error');
        }
    } catch (error) {
        showToast('❌ Error al agregar activo', 'error');
    } finally {
        btn.innerText = originalText;
    }
}

async function removeAsset(symbol) {
    if (confirm(`¿Seguro que quieres eliminar ${symbol} de la pizarra?`)) {
        try {
            const response = await fetch(`/api/market/${symbol}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showToast(`🗑️ ${symbol} eliminado.`, 'success');

                if (symbol === currentAsset) {
                    const remaining = Object.keys(realTimePrices).filter(k => k !== symbol);
                    if (remaining.length > 0) loadAsset(remaining[0]);
                }

                fetchMarketDataAndLeaderboard();
            } else {
                showToast('❌ Error al eliminar activo.', 'error');
            }
        } catch (e) {
            showToast('❌ Error de conexión.', 'error');
        }
    }
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

function handleEnter(e) {
    if (e.key === 'Enter') addNewAsset();
}
const INITIAL_CAPITAL = 100000;
const STUDENT_DB_URL = '/api/db/';

let realTimePrices = {};
let currentAsset = 'NVDA';
let currentUser = null;
let db = {};
let chatHistory = {};
let previousPrices = {};

let countDownDate = new Date("Jan 27, 2026 00:00:00").getTime();

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    initHeatmapTooltip();

    updateMarketStatus();
    setInterval(updateMarketStatus, 60000);
    setInterval(fetchMarketDataAndLeaderboard, 5000);
    setInterval(updateTimer, 1000);

    // Resize handler para el treemap
    window.addEventListener('resize', debounce(() => {
        if (document.getElementById('markets').classList.contains('active')) {
            renderTreemap();
        }
    }, 250));
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function initializeApp() {
    try {
        await Promise.all([fetchMarketDataAndLeaderboard(), fetchCopaConfig()]);
        loadUserDataFromBackend();
        renderAssetList();
        renderTreemap();
        loadAsset('NVDA');

        // Ocultar loader inicial
        const loader = document.getElementById('initialLoader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        }
    } catch (e) {
        showToast('❌ Error crítico al iniciar el sistema.', 'error');
        console.error("Error al inicializar la app:", e);
    }
}

async function fetchCopaConfig() {
    try {
        const res = await fetch('/api/copa-config');
        if (res.ok) {
            const data = await res.json();
            countDownDate = new Date(data.end_date).getTime();
        }
    } catch (e) {
        console.warn('No se pudo cargar la config de la copa.');
    }
}

function openResetModal() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    document.getElementById('resetDateInput').value = d.toISOString().slice(0, 16);
    document.getElementById('resetPasswordInput').value = '';
    document.getElementById('resetCopaModal').classList.add('active');
}

function closeResetModal() {
    document.getElementById('resetCopaModal').classList.remove('active');
}

async function handleResetCopa() {
    const date = document.getElementById('resetDateInput').value;
    const password = document.getElementById('resetPasswordInput').value.trim();
    const btn = document.querySelector('.modal-btn-confirm');

    if (!date) return showToast('⚠️ Seleccioná una fecha.', 'error');
    if (!password) return showToast('⚠️ Ingresá la contraseña.', 'error');

    btn.textContent = 'Procesando...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/reset-copa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, end_date: new Date(date).toISOString() })
        });
        const result = await res.json();

        if (res.ok) {
            countDownDate = new Date(result.end_date).getTime();

            // Limpiar estado local
            db = {};
            if (currentUser) studentLogout();
            document.getElementById('leaderboardBody').innerHTML = '';

            closeResetModal();
            showToast('✅ Copa reiniciada correctamente.', 'success');
            await fetchMarketDataAndLeaderboard();
        } else {
            showToast(`❌ ${result.detail}`, 'error');
        }
    } catch (e) {
        showToast('❌ Error de conexión.', 'error');
    } finally {
        btn.textContent = 'Confirmar Reset';
        btn.disabled = false;
    }
}

let errorCount = 0;

async function fetchMarketDataAndLeaderboard() {
    try {
        const [marketResponse, leaderboardResponse] = await Promise.all([
            fetch('/api/market-data'),
            fetch('/api/leaderboard')
        ]);

        if (!marketResponse.ok || !leaderboardResponse.ok) throw new Error("Error en API");

        const marketData = await marketResponse.json();
        const leaderboardData = await leaderboardResponse.json();

        const hasChanges = detectPriceChanges(marketData);

        realTimePrices = marketData;
        renderAssetList();

        if (hasChanges) {
            updateTreemapValues();
        }

        renderLeaderboard(leaderboardData);

        if (currentUser) updateUIForUser(true);

        errorCount = 0;

    } catch (error) {
        console.warn("⚠️ Fallo silencioso al actualizar mercado:", error);
        errorCount++;

        if (errorCount >= 3) {
            showToast('⚠️ Conexión inestable con el mercado.', 'error');
            errorCount = 0;
        }
    }
}

function detectPriceChanges(newData) {
    const newSymbols = Object.keys(newData);
    const oldSymbols = Object.keys(previousPrices);

    if (newSymbols.length !== oldSymbols.length) {
        previousPrices = JSON.parse(JSON.stringify(newData));
        return true;
    }

    for (const symbol of newSymbols) {
        if (!previousPrices[symbol]) {
            previousPrices = JSON.parse(JSON.stringify(newData));
            return true;
        }
        if (previousPrices[symbol].price !== newData[symbol].price ||
            previousPrices[symbol].change_percent !== newData[symbol].change_percent) {
            previousPrices = JSON.parse(JSON.stringify(newData));
            return true;
        }
    }

    return false;
}

// ==================== TREEMAP SQUARIFIED ALGORITHM ====================

class Treemap {
    constructor(container, data) {
        this.container = container;
        this.data = data;
    }

    render() {
        const rect = this.container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        if (width === 0 || height === 0) return;

        // Preparar datos con valores normalizados
        const totalValue = this.data.reduce((sum, d) => sum + d.value, 0);
        const items = this.data.map(d => ({
            ...d,
            normalizedValue: (d.value / totalValue) * width * height
        })).sort((a, b) => b.value - a.value);

        // Calcular layout
        const rects = this.squarify(items, { x: 0, y: 0, width, height }, []);

        // Generar HTML
        let html = '';
        rects.forEach(r => {
            const color = this.getColor(r.change);
            const textColor = '#ffffff';
            const sign = r.change >= 0 ? '+' : '';

            // Determinar tamaño de fuente basado en el área
            const area = r.width * r.height;
            const fontSize = this.getFontSize(area, r.width, r.height);

            html += `
                <div class="treemap-tile"
                     id="tile-${r.symbol}"
                     data-symbol="${r.symbol}"
                     data-name="${r.name || r.symbol}"
                     data-price="${r.price}"
                     data-change="${r.change}"
                     style="
                        left: ${r.x}px;
                        top: ${r.y}px;
                        width: ${r.width}px;
                        height: ${r.height}px;
                        background-color: ${color};
                     "
                     onclick="loadAssetFromHeatmap('${r.symbol}')">
                    <div class="tile-overlay"></div>
                    <div class="tile-inner" style="color: ${textColor}">
                        ${r.height > 50 && r.width > 60 ? `<span class="tile-symbol" style="font-size: ${fontSize.symbol}px">${r.symbol}</span>` : ''}
                        ${r.height > 70 && r.width > 70 ? `<span class="tile-change" style="font-size: ${fontSize.change}px">${sign}${r.change.toFixed(2)}%</span>` : ''}
                        ${r.height > 90 && r.width > 90 ? `<span class="tile-price" style="font-size: ${fontSize.price}px">$${r.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
                        ${r.height > 115 && r.width > 120 && r.name ? `<span class="tile-name" style="font-size: ${Math.min(10, fontSize.price)}px">${r.name.substring(0, 20)}</span>` : ''}
                    </div>
                </div>
            `;
        });

        this.container.innerHTML = html;
    }

    getFontSize(area, width, height) {
        const minDim = Math.min(width, height);

        if (area > 40000) {
            return { symbol: Math.min(32, minDim * 0.25), change: Math.min(24, minDim * 0.18), price: Math.min(14, minDim * 0.1) };
        } else if (area > 20000) {
            return { symbol: Math.min(24, minDim * 0.22), change: Math.min(18, minDim * 0.15), price: Math.min(12, minDim * 0.09) };
        } else if (area > 10000) {
            return { symbol: Math.min(20, minDim * 0.2), change: Math.min(14, minDim * 0.12), price: Math.min(11, minDim * 0.08) };
        } else if (area > 5000) {
            return { symbol: Math.min(16, minDim * 0.18), change: Math.min(12, minDim * 0.1), price: Math.min(10, minDim * 0.07) };
        } else {
            return { symbol: Math.min(14, minDim * 0.15), change: Math.min(11, minDim * 0.09), price: Math.min(9, minDim * 0.06) };
        }
    }

    getColor(change) {
        const maxChange = 3;
        const normalized = Math.max(-1, Math.min(1, change / maxChange));

        if (Math.abs(change) < 0.05) {
            return 'hsl(210, 8%, 17%)';
        }

        if (normalized > 0) {
            const t = Math.pow(normalized, 0.65);
            const saturation = Math.round(65 + 25 * t);  // 65% → 90%
            const lightness = Math.round(14 + 28 * t);  // 14% → 42%
            return `hsl(145, ${saturation}%, ${lightness}%)`;
        } else {
            const t = Math.pow(Math.abs(normalized), 0.65);
            const saturation = Math.round(65 + 25 * t);  // 65% → 90%
            const lightness = Math.round(14 + 30 * t);  // 14% → 44%
            return `hsl(2, ${saturation}%, ${lightness}%)`;
        }
    }

    squarify(items, rect, result) {
        if (items.length === 0) return result;

        if (items.length === 1) {
            result.push({
                ...items[0],
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
            return result;
        }

        const isWide = rect.width >= rect.height;
        const side = isWide ? rect.height : rect.width;

        let row = [];
        let rowArea = 0;
        let remaining = [...items];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const testRow = [...row, item];
            const testArea = rowArea + item.normalizedValue;

            if (row.length === 0 || this.worstRatio(testRow, testArea, side) <= this.worstRatio(row, rowArea, side)) {
                row = testRow;
                rowArea = testArea;
                remaining = items.slice(i + 1);
            } else {
                break;
            }
        }

        // Layout the row
        const rowRects = this.layoutRow(row, rect, isWide);
        result.push(...rowRects);

        // Calculate remaining rectangle
        const usedSize = rowArea / side;
        let newRect;

        if (isWide) {
            newRect = {
                x: rect.x + usedSize,
                y: rect.y,
                width: rect.width - usedSize,
                height: rect.height
            };
        } else {
            newRect = {
                x: rect.x,
                y: rect.y + usedSize,
                width: rect.width,
                height: rect.height - usedSize
            };
        }

        return this.squarify(remaining, newRect, result);
    }

    worstRatio(row, area, side) {
        if (row.length === 0) return Infinity;

        const rowSize = area / side;
        let worst = 0;

        for (const item of row) {
            const itemSize = item.normalizedValue / rowSize;
            const ratio = Math.max(rowSize / itemSize, itemSize / rowSize);
            worst = Math.max(worst, ratio);
        }

        return worst;
    }

    layoutRow(row, rect, isWide) {
        const totalValue = row.reduce((sum, item) => sum + item.normalizedValue, 0);
        const side = isWide ? rect.height : rect.width;
        const rowSize = totalValue / side;

        let offset = 0;
        const rects = [];

        for (const item of row) {
            const itemSize = item.normalizedValue / rowSize;

            if (isWide) {
                rects.push({
                    ...item,
                    x: rect.x,
                    y: rect.y + offset,
                    width: rowSize,
                    height: itemSize
                });
            } else {
                rects.push({
                    ...item,
                    x: rect.x + offset,
                    y: rect.y,
                    width: itemSize,
                    height: rowSize
                });
            }

            offset += itemSize;
        }

        return rects;
    }
}

function renderTreemap() {
    const container = document.getElementById('treemapContainer');
    if (!container) return;

    const symbols = Object.keys(realTimePrices);

    if (symbols.length === 0) {
        container.innerHTML = `
            <div class="treemap-empty">
                <div class="empty-icon">📊</div>
                <div class="empty-title">Panel de Mercado Vacío</div>
                <div class="empty-subtitle">Agrega acciones desde la pestaña "Trading Competition"</div>
            </div>
        `;
        return;
    }

    // Preparar datos para el treemap
    const data = symbols.map(symbol => {
        const asset = realTimePrices[symbol];
        return {
            symbol: symbol,
            name: asset.name,
            value: asset.market_cap || 1000000000, // Market cap como valor
            change: asset.change_percent,
            price: asset.price,
            sector: asset.sector
        };
    });

    const treemap = new Treemap(container, data);
    treemap.render();

    previousPrices = JSON.parse(JSON.stringify(realTimePrices));
}

function updateTreemapValues() {
    const container = document.getElementById('treemapContainer');
    if (!container) return;

    const symbols = Object.keys(realTimePrices);
    const tiles = container.querySelectorAll('.treemap-tile');
    const existingSymbols = Array.from(tiles).map(t => t.dataset.symbol);

    // Si cambió la estructura, re-renderizar completo
    if (symbols.length !== existingSymbols.length ||
        !symbols.every(s => existingSymbols.includes(s))) {
        renderTreemap();
        return;
    }

    // Solo actualizar valores y colores
    const treemap = new Treemap(container, []);

    symbols.forEach(symbol => {
        const tile = document.getElementById(`tile-${symbol}`);
        if (!tile) return;

        const data = realTimePrices[symbol];
        const change = data.change_percent;
        const price = data.price;
        const color = treemap.getColor(change);
        const sign = change >= 0 ? '+' : '';

        tile.style.backgroundColor = color;
        tile.classList.remove('tile-updated');
        void tile.offsetWidth; // trigger reflow para reiniciar animación
        tile.classList.add('tile-updated');

        const changeEl = tile.querySelector('.tile-change');
        const priceEl = tile.querySelector('.tile-price');

        if (changeEl) changeEl.textContent = `${sign}${change.toFixed(2)}%`;
        if (priceEl) priceEl.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    });
}

function initHeatmapTooltip() {
    const container = document.getElementById('treemapContainer');
    const tooltip = document.getElementById('heatmapTooltip');
    if (!container || !tooltip) return;

    container.addEventListener('mousemove', (e) => {
        const tile = e.target.closest('.treemap-tile');
        if (!tile) { tooltip.classList.remove('visible'); return; }

        const name = tile.dataset.name;
        const price = parseFloat(tile.dataset.price);
        const change = parseFloat(tile.dataset.change);
        const sign = change >= 0 ? '+' : '';
        const cls = change >= 0 ? 'tt-positive' : 'tt-negative';

        tooltip.innerHTML = `
            <div class="tt-name">${name}</div>
            <div class="tt-row"><span>Precio</span><span>$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div class="tt-row"><span>Variación</span><span class="${cls}">${sign}${change.toFixed(2)}%</span></div>
        `;
        tooltip.classList.add('visible');

        const offset = 16;
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const x = e.clientX + offset + tw > window.innerWidth ? e.clientX - tw - offset : e.clientX + offset;
        const y = e.clientY + offset + th > window.innerHeight ? e.clientY - th - offset : e.clientY + offset;
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    });

    container.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}

function loadAssetFromHeatmap(symbol) {
    switchTab('explorer', document.querySelectorAll('.nav-tab')[1]);
    loadAsset(symbol);
}

// ==================== FIN TREEMAP ====================

function updateMarketStatus() {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    const isWeekday = day >= 1 && day <= 5;
    const isOpenTime = hour >= 11 && hour < 17;

    const pill = document.getElementById('marketStatusPill');
    const text = document.getElementById('marketStatusText');

    if (!pill || !text) return;

    if (isWeekday && isOpenTime) {
        pill.classList.remove('status-closed');
        text.innerText = "MERCADO ABIERTO";
    } else {
        pill.classList.add('status-closed');
        text.innerText = "MERCADO CERRADO";
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

    // Re-render treemap cuando se activa la pestaña
    if (id === 'markets') {
        setTimeout(() => renderTreemap(), 50);
    }
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

let isWaitingForCode = false;
let tempUsername = "";

function handleLoginEnter(e) {
    if (e.key === 'Enter') handleLoginStep();
}

async function handleLoginStep() {
    const input = document.getElementById('loginInput');
    const val = input.value.trim();
    const btn = document.getElementById('loginBtn');

    if (!val) return showToast('⚠️ Campo vacío', 'error');

    if (!isWaitingForCode) {
        tempUsername = val;

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
                isWaitingForCode = true;

                showToast(`📧 ${result.message}`, 'success');

                document.getElementById('loginTitle').innerText = "Verificar Identidad";
                document.getElementById('loginSubtitle').innerText = `Ingresa el código enviado a ${tempUsername}@uade.edu.ar`;
                input.value = "";
                input.placeholder = "Código de 6 dígitos";
                input.type = "number";
                input.disabled = false;
                input.focus();

                btn.innerText = "Verificar e Ingresar";
                document.getElementById('loginFooter').innerHTML = `<a href="#" onclick="resetLogin()" style="color:#787b86">¿Te equivocaste de usuario? Volver</a>`;

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
                currentUser = { usuario: result.userId, ...result.userData };
                db[currentUser.usuario] = result.userData;

                updateUIForUser();

                document.getElementById('loginPanel').style.display = 'none';
                document.getElementById('tradingPanel').classList.add('active');
                showToast('🚀 Sesión iniciada correctamente', 'success');

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
    input.placeholder = "Ej: warrenbuffett";
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

function studentLogout() {
    currentUser = null;
    resetLogin();
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

    const sellBtn = document.querySelector('.btn-sell');
    const ownedQty = userData.portfolio[currentAsset] || 0;

    if (sellBtn) {
        if (ownedQty > 0) {
            sellBtn.disabled = false;
            sellBtn.style.opacity = "1";
            sellBtn.style.cursor = "pointer";
            sellBtn.title = "Vender acciones";
        } else {
            sellBtn.disabled = true;
            sellBtn.style.opacity = "0.3";
            sellBtn.style.cursor = "not-allowed";
            sellBtn.title = "No tenés acciones de esta empresa para vender";
        }
    }

    const list = document.getElementById('holdingsList');
    list.innerHTML = '';
    const entries = Object.entries(userData.portfolio);

    if (entries.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Sin activos</div>';
    } else {
        entries.forEach(([symbol, qty]) => {
            if (qty > 0) {
                const assetPrice = realTimePrices[symbol] ? realTimePrices[symbol].price : 0;
                const totalVal = qty * assetPrice;
                list.innerHTML += `
                    <div class="holding-item">
                        <div>
                            <strong>${symbol}</strong> 
                            <span style="color:var(--text-muted)">
                        </div>
                        <div>${formatMoney(totalVal)}</div>
                    </div>`;
            }
        });
    }
}

async function executeOrder(type) {
    const qtyInput = document.getElementById('orderQty');
    const qty = parseInt(qtyInput.value);

    const btnBuy = document.querySelector('.btn-buy');
    const btnSell = document.querySelector('.btn-sell');

    if (!qty || qty <= 0) return showToast('Cantidad inválida', 'error');

    if (type === 'sell') {
        const owned = db[currentUser.usuario].portfolio[currentAsset] || 0;
        if (qty > owned) {
            return showToast(`❌ Error: Solo tienes ${owned} acciones para vender.`, 'error');
        }
    }

    btnBuy.disabled = true;
    btnSell.disabled = true;

    if (type === 'buy') btnBuy.innerText = "⏳ ...";
    else btnSell.innerText = "⏳ ...";

    btnBuy.style.opacity = "0.5";
    btnSell.style.opacity = "0.5";
    btnBuy.style.cursor = "wait";
    btnSell.style.cursor = "wait";

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
            currentUser.portfolio = result.userData.portfolio;

            showToast(`✅ ${type === 'buy' ? 'Compra' : 'Venta'} Exitosa`, 'success');
            addToFeed(currentUser.usuario, currentAsset, type.toUpperCase(), qty);

            await fetchMarketDataAndLeaderboard();

        } else {
            showToast(`❌ ${result.detail || 'Error en la operación'}`, 'error');
        }

    } catch (error) {
        showToast('❌ Error de conexión con el servidor de trading', 'error');
    } finally {
        btnBuy.disabled = false;
        btnSell.disabled = false;

        btnBuy.innerText = "Comprar";
        btnSell.innerText = "Vender";

        btnBuy.style.opacity = "1";
        btnBuy.style.cursor = "pointer";

        updateUIForUser();
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
    if (feed.children.length > 8) feed.lastChild.remove();
}

function renderLeaderboard(students) {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';

    students.forEach((s, index) => {
        let rankClass = 'rank-other';
        let rankIcon = index + 1;
        if (index === 0) { rankClass = 'rank-1'; rankIcon = '♛'; }
        if (index === 1) rankClass = 'rank-2';
        if (index === 2) rankClass = 'rank-3';

        const roiClass = s.roi >= 0 ? 'roi-positive' : 'roi-negative';
        const rowBg = (currentUser && currentUser.usuario === s.usuario) ? 'background: rgba(255, 255, 255, 0.05);' : '';

        tbody.innerHTML += `
            <tr style="${rowBg}">
                <td><div class="rank-badge ${rankClass}">${rankIcon}</div></td>
                <td style="font-family:'JetBrains Mono'; color: var(--text-main);">${s.usuario}</td>
                <td style="text-align:right; font-family:'JetBrains Mono'">${formatMoney(s.total)}</td>
                <td style="text-align:right" class="${roiClass}">${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(2)}%</td>
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
        const sign = p.change_percent > 0 ? '+' : '';

        const trashIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        container.innerHTML += `
            <div class="asset-item ${activeClass}" onclick="loadAsset('${symbol}')">
                
                <div style="overflow: hidden;">
                    <div class="asset-symbol">${symbol}</div>
                    <div class="asset-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name || symbol}</div>
                </div>

                <button class="btn-remove" onclick="event.stopPropagation(); removeAsset('${symbol}')" title="Eliminar">
                    ${trashIcon}
                </button>

                <div class="asset-price-mini">
                    $${p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>

                <div class="asset-change-mini ${priceClass}">
                    ${sign}${p.change_percent.toFixed(2)}%
                </div>

            </div>
        `;
    });
}

function loadTradingViewChart(symbol) {
    let tvSymbol = symbol;

    if (symbol === 'BRK') {
        tvSymbol = 'NYSE:BRK.B';
    }
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
    if (!realTimePrices[symbol] && Object.keys(realTimePrices).length > 0) {
        symbol = Object.keys(realTimePrices)[0];
    }

    currentAsset = symbol;
    const data = realTimePrices[symbol] || { name: symbol, sector: 'General', volatility: 0 };

    if (document.getElementById('metaName')) document.getElementById('metaName').innerText = data.name;

    // Formatting helpers
    const fMoney = val => val ? `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
    const fNum = val => val ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

    function formatBigNumber(num) {
        if (!num) return '-';
        if (num >= 1e12) return (num / 1e12).toFixed(3) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(3) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(3) + 'M';
        return num.toLocaleString();
    }

    // Populate the new Financial Grid
    if (document.getElementById('finPrevClose')) document.getElementById('finPrevClose').innerText = fMoney(data.previous_close);
    if (document.getElementById('finOpen')) document.getElementById('finOpen').innerText = fMoney(data.open_price);

    const dayRange = data.day_low && data.day_high ? `${fNum(data.day_low)} - ${fNum(data.day_high)}` : '-';
    if (document.getElementById('finDayRange')) document.getElementById('finDayRange').innerText = dayRange;

    const week52Range = data.fifty_two_week_low && data.fifty_two_week_high ? `${fNum(data.fifty_two_week_low)} - ${fNum(data.fifty_two_week_high)}` : '-';
    if (document.getElementById('fin52Week')) document.getElementById('fin52Week').innerText = week52Range;

    if (document.getElementById('finVolume')) document.getElementById('finVolume').innerText = data.volume ? data.volume.toLocaleString() : '-';
    if (document.getElementById('finAvgVol')) document.getElementById('finAvgVol').innerText = data.avg_volume ? data.avg_volume.toLocaleString() : '-';

    if (document.getElementById('finMarketCap')) document.getElementById('finMarketCap').innerText = formatBigNumber(data.market_cap);
    if (document.getElementById('finBeta')) document.getElementById('finBeta').innerText = fNum(data.pe_ratio); // Note: We don't have beta from fundamental_data directly except volatility
    if (document.getElementById('finPE')) document.getElementById('finPE').innerText = fNum(data.pe_ratio);
    if (document.getElementById('finEPS')) document.getElementById('finEPS').innerText = fNum(data.eps);
    if (document.getElementById('finEarnings')) document.getElementById('finEarnings').innerText = data.earnings_date || '-';
    if (document.getElementById('finDiv')) document.getElementById('finDiv').innerText = data.dividend_yield || '-';

    if (document.getElementById('finExDiv')) document.getElementById('finExDiv').innerText = data.ex_dividend_date || '-';
    if (document.getElementById('finTargetEst')) document.getElementById('finTargetEst').innerText = fMoney(data.target_est);
    if (document.getElementById('finSector')) document.getElementById('finSector').innerText = data.sector || '-';

    // Volatilidad -> Beta fallback si quisieras 
    if (document.getElementById('finBeta')) document.getElementById('finBeta').innerText = data.volatility ? data.volatility.toFixed(2) : '-';

    if (document.getElementById('chat-context-asset')) document.getElementById('chat-context-asset').innerText = symbol;

    const btnTv = document.getElementById('btnTradingView');
    if (btnTv) {
        let searchSymbol = symbol;
        if (symbol === 'BRK') searchSymbol = 'BRK.B';

        btnTv.href = `https://es.tradingview.com/symbols/${searchSymbol}/`;
    }

    renderAssetList();
    if (currentUser) updateUIForUser();

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

            previousPrices = {};
            await fetchMarketDataAndLeaderboard();
            renderTreemap();

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

                previousPrices = {};
                await fetchMarketDataAndLeaderboard();
                renderTreemap();
            } else {
                showToast('❌ Error al eliminar activo.', 'error');
            }
        } catch (e) {
            showToast('❌ Error de conexión.', 'error');
        }
    }
}

function formatMoney(num) {
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg, type) {
    const x = document.getElementById("toast");
    x.innerText = msg;
    x.style.borderLeft = `5px solid ${type === 'error' ? 'var(--danger)' : 'var(--success)'}`;
    x.className = "show";
    setTimeout(function () { x.className = x.className.replace("show", ""); }, 3000);
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
            { role: 'incoming', text: `Hola. Estoy analizando el gráfico de ${symbol}.\n¿En qué te puedo ayudar?` }
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
    const assetData = realTimePrices[currentAsset] || {};
    const price = assetData.price || 'N/A';
    const sector = assetData.sector || 'General';
    const userMessage = chatHistory[currentAsset]?.slice(-1)?.[0]?.text || chatInput.value;

    try {
        const response = await fetch('/api/chat', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userMessage, asset: currentAsset, price: String(price), sector }),
        });

        if (!response.ok) throw new Error('Server error');

        const data = await response.json();
        const aiText = data.reply;
        messageElement.textContent = aiText;

        chatHistory[currentAsset].push({ role: 'incoming', text: aiText });

    } catch (error) { messageElement.textContent = "Error de conexión con la IA."; }
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

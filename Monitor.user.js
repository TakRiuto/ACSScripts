// ==UserScript==
// @name         OLT Monitor Maestro
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/monitoring/olt/*
// @version      16.3
// @inject-into  content
// @run-at       document-end
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/Monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/Monitor.user.js
// @grant        GM_fetch
// @connect      raw.githubusercontent.com
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(async function() {
    'use strict';
    if (window.self !== window.top) return;

    // =========================================================
    // DB
    // =========================================================
    let DB_NODOS = {};
    let dbCargada = true;
    try {
        DB_NODOS = await fetch(`https://raw.githubusercontent.com/TakRiuto/ACSScripts/refs/heads/release/nodos.json?t=${Date.now()}`)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            });
        console.log('✅ DB_NODOS cargado:', Object.keys(DB_NODOS).length, 'nodos');
    } catch (e) {
        console.error('❌ Error cargando nodos.json:', e);
        dbCargada = false;
    }

    // =========================================================
    // ESTADO
    // =========================================================
    let oltActual = "";
    let modoCargaInicial = true;
    let umbralValor = parseFloat(localStorage.getItem('oltUmbralValor')) || 30;
    let umbralTipo = localStorage.getItem('oltUmbralTipo') || 'porcentaje';
    let filtroOp = localStorage.getItem('oltFiltroOp') || 'TODOS';
    let logBusqueda = '';
    let escala = parseFloat(localStorage.getItem('oltPanelEscala')) || 1;
    let panelState = 'minimizado';
    let modoPreferido = localStorage.getItem('oltModoPreferido') || 'abierto';

    let ultimoHTMLRenderizado = '';
    let ultimoEstadoPestana = { criticos: -1, hayNuevos: null };

    const registroNodos = new Map();
    const memoriaRedGlobal = new Map();

    // =========================================================
    // AUDIO
    // =========================================================
    const AUDIOS = {
        dosimeter:    new Audio('https://actions.google.com/sounds/v1/alarms/dosimeter_alarm.ogg'),
        alarm:        new Audio('https://www.myinstants.com/media/sounds/alarm.MP3'),
        alarmabrazil: new Audio('https://www.myinstants.com/media/sounds/brazil-alarm.mp3'),
        alarmhard:    new Audio('https://www.myinstants.com/media/sounds/chicken-on-tree-screaming.mp3'),
        chevette99:   new Audio('https://soundbible.com/grab.php?id=2214&type=mp3')
    };
    Object.values(AUDIOS).forEach(a => { a.preload = 'auto'; a.loop = true; });

    const alarmaGuardada = localStorage.getItem('oltAlarmaSeleccionada') || 'dosimeter';
    let sonidoAlerta = AUDIOS[alarmaGuardada] || AUDIOS.alarm;

    let silenciado = false;
    let muteGlobal = localStorage.getItem('oltMuteGlobal') === 'true';
    let enPrueba = false;
    let audioAutorizado = false;

    document.addEventListener('click', () => {
        if (!audioAutorizado) {
            audioAutorizado = true;
            Object.values(AUDIOS).forEach(a => {
                a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
            });
        }
    }, { once: true });

    function detenerSonido() {
        sonidoAlerta.pause();
        sonidoAlerta.currentTime = 0;
    }

    // =========================================================
    // LOG
    // =========================================================
    let logEntradas = [];

    function timestamp() {
        const now = new Date();
        const fecha = now.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const hora = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `${fecha} ${hora}`;
    }

    function registrarLog(tipo, nodo, datos) {
        logEntradas.unshift({ tipo, nodo, datos, ts: timestamp() });
        if (logEntradas.length > 2000) logEntradas.splice(2000);
        renderizarLog();
    }

    function exportarLog() {
        const lineas = [`OLT: ${oltActual} - LOG DE EVENTOS`, `Exportado: ${timestamp()}`, '─'.repeat(80)];
        logEntradas.forEach(e => {
            const b = `[${e.ts}] ${e.nodo}`;
            if (e.tipo === 'inicial')        lineas.push(`${b} | INICIO     | ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total} (${e.datos.zona} | ${e.datos.op})`);
            if (e.tipo === 'inicial_alarma') lineas.push(`${b} | INI_ALARM  | ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total} (${e.datos.zona} | ${e.datos.op})`);
            if (e.tipo === 'nueva_alarma')   lineas.push(`${b} | ALARMA     | Antes:ON:${e.datos.onPrev||0} OFF:${e.datos.offPrev||0} (${e.datos.pDownPrev||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'empeora')        lineas.push(`${b} | EMPEORA    | Antes:ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'mejora')         lineas.push(`${b} | MEJORA     | Antes:ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'recuperado')     lineas.push(`${b} | RECUPERA   | Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes}%) -> Ahora: ON:${e.datos.onActual} OFF:${e.datos.offActual} (${e.datos.pDownActual}%) | TOT: ${e.datos.total}`);
        });
        const blob = new Blob([lineas.join('\n')], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `log_${oltActual}_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
    }

    function exportarCSV() {
        const ESTATUS = { inicial: 'INICIO', inicial_alarma: 'INICIO_ALARMADO', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', mejora: 'MEJORA', recuperado: 'RECUPERADO' };
        const esc = v => `"${String(v).replace(/"/g, '""')}"`;
        const enc = ['Fecha', 'Hora', 'OLT', 'Nodo', 'Ubicacion', 'Operadora', 'Estatus', 'ON Ant', 'OFF Ant', '% Ant', 'ON Act', 'OFF Act', '% Act', 'TOT'];
        const filas = logEntradas.map(e => {
            const [fecha, hora] = e.ts.split(' ');
            let oA = '', oF = '', pA = '', nA = '', nF = '', pN = '', total = '';
            if (e.tipo === 'inicial' || e.tipo === 'inicial_alarma') {
                nA = e.datos.on; nF = e.datos.off; pN = `${e.datos.pDown}%`; total = e.datos.total;
            } else if (e.tipo === 'nueva_alarma') {
                oA = e.datos.onPrev||0; oF = e.datos.offPrev||0; pA = `${e.datos.pDownPrev||0}%`;
                nA = e.datos.on; nF = e.datos.off; pN = `${e.datos.pDown}%`; total = e.datos.total;
            } else if (e.tipo === 'empeora' || e.tipo === 'mejora') {
                oA = e.datos.onAntes; oF = e.datos.offAntes; pA = `${e.datos.pDownAntes||0}%`;
                nA = e.datos.on; nF = e.datos.off; pN = `${e.datos.pDown}%`; total = e.datos.total;
            } else if (e.tipo === 'recuperado') {
                oA = e.datos.onAntes; oF = e.datos.offAntes; pA = `${e.datos.pDownAntes||0}%`;
                nA = e.datos.onActual; nF = e.datos.offActual; pN = `${e.datos.pDownActual||0}%`; total = e.datos.onActual + e.datos.offActual;
            }
            return [esc(fecha), esc(hora), esc(oltActual), esc(e.nodo), esc(e.datos.zona||''), esc(e.datos.op||''), esc(ESTATUS[e.tipo]||e.tipo), oA, oF, esc(pA), nA, nF, esc(pN), esc(total)].join(',');
        });
        const blob = new Blob(['\uFEFF' + [enc.join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `log_${oltActual}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    function renderizarLog() {
        const contenedor = document.getElementById('log-list');
        if (!contenedor) return;
        if (logEntradas.length === 0) {
            contenedor.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin eventos registrados.</div>';
            return;
        }
        const colores = { inicial: '#555', inicial_alarma: '#ed5565', nueva_alarma: '#ed5565', empeora: '#e67e22', mejora: '#f1c40f', recuperado: '#1ab394' };
        const iconos  = { inicial: '📋', inicial_alarma: '🔴', nueva_alarma: '🔴', empeora: '📉', mejora: '📈', recuperado: '✅' };
        const labels  = { inicial: 'INICIO', inicial_alarma: 'INICIO (ALARMADO)', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', mejora: 'MEJORA', recuperado: 'RECUPERADO' };

        const entradasFiltradas = logBusqueda
            ? logEntradas.filter(e => e.nodo.toLowerCase().includes(logBusqueda) || (e.datos.zona || '').toLowerCase().includes(logBusqueda))
            : logEntradas;

        if (!entradasFiltradas.length) {
            contenedor.innerHTML = `<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin resultados para "<b>${logBusqueda}</b>"</div>`;
            return;
        }

        contenedor.innerHTML = entradasFiltradas.map(e => {
            let detalle = '';
            if (e.tipo === 'inicial' || e.tipo === 'inicial_alarma') {
                detalle = `ON: <b>${e.datos.on}</b> | OFF: <b>${e.datos.off}</b> (${e.datos.pDown}%) | TOT: ${e.datos.total}`;
            } else if (e.tipo === 'nueva_alarma') {
                detalle = `Antes: ON:${e.datos.onPrev||0} OFF:${e.datos.offPrev||0} (${e.datos.pDownPrev||0}%) → <b>Ahora: ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%)</b>`;
            } else if (e.tipo === 'empeora' || e.tipo === 'mejora') {
                detalle = `Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) → <b>Ahora: ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%)</b>`;
            } else if (e.tipo === 'recuperado') {
                detalle = `Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes}%) → <b>Ahora: ON:${e.datos.onActual} OFF:${e.datos.offActual} (${e.datos.pDownActual}%)</b>`;
            }
            const zona = e.datos.zona || '';
            const op   = e.datos.op   || '';
            return `
                <div style="margin-bottom:7px;padding:7px 8px;border-left:4px solid ${colores[e.tipo]};background:rgba(255,255,255,0.04);border-radius:0 4px 4px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:${colores[e.tipo]};font-size:10px;font-weight:bold;">${iconos[e.tipo]} ${labels[e.tipo]}</span>
                        <span style="color:#555;font-size:9px;">${e.ts}</span>
                    </div>
                    <div style="color:#ccc;font-size:12px;font-weight:bold;margin:2px 0;">${e.nodo}</div>
                    ${zona || op ? `<div style="color:#888;font-size:10px;">📍${zona} | 🏢${op}</div>` : ''}
                    <div style="color:#aaa;font-size:10px;">${detalle}</div>
                </div>`;
        }).join('');
    }

    // =========================================================
    // FAVICON
    // =========================================================
    let faviconEl = document.querySelector("link[rel~='icon']");
    if (!faviconEl) {
        faviconEl = document.createElement('link');
        faviconEl.rel = 'icon';
        document.head.appendChild(faviconEl);
    }
    const faviconCanvas = document.createElement('canvas');
    faviconCanvas.width = 32;
    faviconCanvas.height = 32;
    const faviconCtx = faviconCanvas.getContext('2d');

    function actualizarPestana(oltName, totalCriticos, hayNuevos) {
        if (ultimoEstadoPestana.criticos === totalCriticos && ultimoEstadoPestana.hayNuevos === hayNuevos) return;
        ultimoEstadoPestana.criticos = totalCriticos;
        ultimoEstadoPestana.hayNuevos = hayNuevos;
        document.title = totalCriticos > 0 ? `${hayNuevos ? '🆕' : '🔴'} (${totalCriticos}) ${oltName}` : `✅ ${oltName}`;
        const color = totalCriticos > 0 ? (hayNuevos ? '#e74c3c' : '#a93226') : '#1ab394';
        faviconCtx.clearRect(0, 0, 32, 32);
        faviconCtx.beginPath();
        faviconCtx.arc(16, 16, 15, 0, 2 * Math.PI);
        faviconCtx.fillStyle = color;
        faviconCtx.fill();
        faviconCtx.fillStyle = '#ffffff';
        faviconCtx.textAlign = 'center';
        faviconCtx.textBaseline = 'middle';
        if (totalCriticos > 0) {
            faviconCtx.font = `bold ${totalCriticos > 9 ? '14' : '18'}px sans-serif`;
            faviconCtx.fillText(totalCriticos > 99 ? '99+' : totalCriticos, 16, 17);
        } else {
            faviconCtx.font = 'bold 20px sans-serif';
            faviconCtx.fillText('✓', 16, 17);
        }
        faviconEl.href = faviconCanvas.toDataURL('image/png');
    }

    // =========================================================
    // CSS
    // =========================================================
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes pulseACS {
            0%, 100% { box-shadow: inset 0 0 0px #fff; background-color: #a93226; }
            50% { box-shadow: inset 0 0 20px #fff; background-color: #ed5565; border:1px solid #fff; }
        }
        @keyframes pulsePanel {
            0%, 100% { background-color: rgba(237,85,101,0.1); border-left:5px solid #ed5565; }
            50% { background-color: rgba(237,85,101,0.6); border-left:5px solid #fff; }
        }
        .celda-acs-blink { animation: pulseACS 0.8s infinite !important; }
        .tarjeta-panel-blink { animation: pulsePanel 1s infinite ease-in-out !important; }
        .badge-nuevo {
            background:#fff; color:#ed5565; font-size:10px; font-weight:900;
            padding:2px 6px; border-radius:4px; margin-left:8px; box-shadow:0 0 8px #fff;
        }
        .header-blink { animation:pulsePanel 0.4s infinite alternate !important; box-shadow:0 0 15px #ed5565 !important; }
        .ctrl {
            background:#222; color:#ed5565; border:1px solid #555;
            border-radius:3px; padding:3px 5px; font-size:11px;
            font-weight:bold; cursor:pointer; outline:none; box-sizing:border-box;
        }
        .ctrl:hover, .ctrl:focus { border-color:#ed5565; }
        input[type=number]::-webkit-inner-spin-button { opacity:1; }
        .tab-btn { flex:1; padding:4px 0; font-size:10px; font-weight:bold; border:none; border-radius:3px; cursor:pointer; }
        .tab-active { background:#ed5565; color:white; }
        .tab-inactive { background:#333; color:#aaa; }
        .mute-permanente { background:#7d3c98 !important; border-color:#9b59b6 !important; color:white !important; }
        .mute-temporal { background:#784212 !important; border-color:#e67e22 !important; color:white !important; }
        .mute-off { background:#333 !important; border-color:#555 !important; color:#ccc !important; }
        #mute-status {
            width:100%; box-sizing:border-box; padding:2px 4px; white-space:normal;
            word-wrap:break-word; line-height:1.3; font-size:10px; font-weight:bold; text-align:center;
        }
        .mute-status-text { background:transparent !important; color:#aaa; border:none; }
        #alert-content { max-height:0; overflow:hidden; transition:max-height 0.25s ease; }
        #alert-content.panel-abierto { max-height:85dvh; overflow-y:auto; }
        #olt-alert-panel { transition:width 0.25s ease, padding 0.25s ease, font-size 0.25s ease; }
        #olt-alert-panel.modo-flotante {
            left:50% !important; bottom:auto !important; top:50% !important;
            transform:translate(-50%, -50%); border-radius:8px !important;
            border:1px solid #555 !important; resize:both; overflow:auto; min-width:320px; min-height:200px;
        }
        #olt-alert-panel.modo-flotante #panel-drag-handle { cursor:pointer; }
        #btn-flotante { font-size:13px; cursor:pointer; opacity:0.6; user-select:none; }
        #btn-flotante:hover { opacity:1; }
        .zoom-buttons { display:flex; gap:4px; margin-top:5px; flex-wrap:wrap; }
        .zoom-btn {
            background:#333; color:#aaa; border:1px solid #555; border-radius:3px;
            padding:3px 6px; font-size:10px; font-weight:bold; cursor:pointer;
            font-family:'Google Sans'; flex:1; text-align:center; transition:background 0.2s;
        }
        .zoom-btn:hover { background:#444; }
        .zoom-btn.active { background:#f1c40f; color:#111; border-color:#e67e22; }
        #olt-alert-panel:not(.modo-flotante) .zoom-buttons { display:none; }
        @media (max-width: 768px) { #btn-flotante { display:none; } }
        #umbral-valor::-webkit-inner-spin-button,
        #umbral-valor::-webkit-outer-spin-button { display: none; }
    `;
    (document.head || document.documentElement).appendChild(style);

    // =========================================================
    // ZOOM
    // =========================================================
    function aplicarZoom() {
        const panel = document.getElementById('olt-alert-panel');
        if (!panel) return;
        panel.style.zoom = panel.classList.contains('modo-flotante') ? escala : '';
    }

    function resaltarBotonZoom() {
        document.querySelectorAll('.zoom-btn').forEach(btn => {
            parseFloat(btn.dataset.scale) === escala ? btn.classList.add('active') : btn.classList.remove('active');
        });
    }

    // =========================================================
    // PANEL
    // =========================================================
    function crearPanel() {
        if (document.getElementById('olt-alert-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'olt-alert-panel';
        panel.innerHTML = `
            <div id="panel-header" style="cursor:pointer;font-weight:bold;border-bottom:1px solid #ed5565;margin-bottom:10px;padding-bottom:5px;font-size:13px;color:#ed5565;display:flex;justify-content:space-between;align-items:center;">
                <span id="panel-drag-handle" style="flex:1;display:flex;align-items:center;gap:6px;">
                    🚨 <span id="alert-count" style="background:#ed5565;color:white;border-radius:10px;padding:0 8px;font-size:11px;">0</span>
                </span>
                <div style="display:flex;align-items:center;gap:5px;">
                    <span id="btn-flotante" title="Modo flotante" onclick="event.stopPropagation()">⧉</span>
                    <span id="toggle-btn" style="font-size:16px;">+</span>
                </div>
            </div>
            ${!dbCargada ? '<div style="background:#a93226;color:white;text-align:center;font-size:9px;padding:2px;border-radius:3px;margin-bottom:5px;">⚠️ Fallo DB_NODOS</div>' : ''}
            <div id="alert-content">
                <div style="display:flex;gap:4px;margin-bottom:10px;">
                    <button id="tab-alarmas" class="tab-btn tab-active">🚨 Alarmas</button>
                    <button id="tab-log" class="tab-btn tab-inactive">📋 Log</button>
                </div>
                <div id="vista-alarmas">
                    <div style="background:rgba(255,255,255,0.05);padding:8px;margin-bottom:10px;border-radius:4px;display:flex;flex-direction:column;gap:5px;">
                        <span style="font-size:10px;color:#aaa;font-weight:bold;">TIPO DE ALARMA:</span>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <select id="selector-alarma" class="ctrl" style="flex:1;">
                                <option value="dosimeter">🌀 Dosimetro</option>
                                <option value="alarm">👂 Alarma</option>
                                <option value="alarmabrazil">🇧🇷 Brazil</option>
                                <option value="alarmhard">🐔 Intenso</option>
                                <option value="chevette99">⚡ Chevette 99</option>
                            </select>
                            <button id="btn-test-play" class="ctrl" style="width:32px;color:#1ab394;" title="Probar sonido">▶</button>
                            <button id="btn-test-stop" class="ctrl" style="width:32px;color:#ed5565;" title="Detener prueba">⏹️</button>
                        </div>
                        <div style="display:flex;gap:5px;">
                            <select id="umbral-tipo" class="ctrl" style="flex:1;">
                                <option value="porcentaje">Porcentaje (%)</option>
                                <option value="cantidad">Cant. Caídos</option>
                            </select>
                            <input type="number" id="umbral-valor" class="ctrl" style="width:55px;text-align:center;" min="1" max="999">
                        </div>
                        <span style="font-size:10px;color:#aaa;font-weight:bold;">OPERADORA:</span>
                        <select id="filtro-op" class="ctrl" style="width:100%;">
                            <option value="TODOS">— Todas —</option>
                        </select>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                            <button id="btn-marcar-todos" style="display:none;flex:1;background:#1ab394;border:none;color:white;font-size:11px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">✔ Marcar vistos</button>
                            <button id="btn-silenciar" class="mute-off" style="flex:1;border:1px solid #555;font-size:11px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">🔇 Silenciar</button>
                        </div>
                        <div id="mute-status" style="display:none;"></div>
                        <div class="zoom-buttons">
                            <button class="zoom-btn" data-scale="0.75">0.75x</button>
                            <button class="zoom-btn" data-scale="1">1x</button>
                            <button class="zoom-btn" data-scale="1.25">1.25x</button>
                            <button class="zoom-btn" data-scale="1.5">1.5x</button>
                            <button class="zoom-btn" data-scale="2">2x</button>
                        </div>
                    </div>
                    <div id="alert-list" style="max-height:calc(60dvh - 240px);overflow-y:auto;scrollbar-width:thin;font-family:'Google Sans',monospace;"></div>
                </div>
                <div id="vista-log" style="display:none;">
                    <input type="text" id="log-busqueda" class="ctrl" style="width:100%;margin-bottom:8px;color:#aaa;" placeholder="🔍 Buscar nodo o urbanismo...">
                    <div style="display:flex;gap:4px;margin-bottom:8px;">
                        <button id="btn-exportar-log" style="flex:1;background:#333;border:1px solid #555;color:#aaa;font-size:10px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">⬇ .TXT</button>
                        <button id="btn-exportar-csv" style="flex:1;background:#1a3a4a;border:1px solid #1a7a9a;color:#5bc8e8;font-size:10px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">⬇ .CSV</button>
                    </div>
                    <div id="log-list" style="max-height:calc(60dvh - 140px);overflow-y:auto;scrollbar-width:thin;font-family:'Google Sans',monospace;"></div>
                </div>
            </div>
        `;

        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', left: '0px', width: '120px',
            backgroundColor: 'rgba(5,5,5,0.98)', color: 'white', padding: '12px',
            borderRadius: '0 8px 8px 0', boxShadow: '5px 0 20px rgba(0,0,0,1)',
            zIndex: '10000', border: '1px solid #444', borderLeft: 'none'
        });
        document.body.appendChild(panel);

        // --- Zoom ---
        panel.querySelectorAll('.zoom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nuevaEscala = parseFloat(btn.dataset.scale);
                if (isNaN(nuevaEscala)) return;
                escala = nuevaEscala;
                localStorage.setItem('oltPanelEscala', escala);
                resaltarBotonZoom();
                aplicarZoom();
            });
        });
        resaltarBotonZoom();

        // --- Máquina de estados del panel ---
        function aplicarEstado(estado) {
            const content    = document.getElementById('alert-content');
            const btnToggle  = document.getElementById('toggle-btn');
            const btnFlotante = document.getElementById('btn-flotante');

            if (estado === 'flotante') {
                panel.classList.add('modo-flotante');
                panel.style.width = '1040px'; panel.style.padding = '18px'; panel.style.fontSize = '15px'; panel.style.zoom = escala;
                content.classList.add('panel-abierto'); content.style.maxHeight = 'none';
                btnToggle.style.display = 'none';
                btnFlotante.style.opacity = '1'; btnFlotante.title = 'Salir de modo flotante';
            } else {
                panel.classList.remove('modo-flotante');
                panel.style.width = estado === 'abierto' ? '360px' : '120px';
                panel.style.padding = '12px'; panel.style.fontSize = ''; panel.style.zoom = '';
                estado === 'abierto' ? content.classList.add('panel-abierto') : content.classList.remove('panel-abierto');
                content.style.maxHeight = '';
                btnToggle.style.display = 'inline'; btnToggle.innerText = estado === 'abierto' ? '−' : '+';
                btnFlotante.style.opacity = '0.6'; btnFlotante.title = 'Modo flotante';
            }
        }

        aplicarEstado('minimizado');

        // --- Controles ---
        document.getElementById('umbral-valor').value = umbralValor;
        document.getElementById('umbral-tipo').value  = umbralTipo;

        const actualizarConfiguracion = () => {
            umbralValor = parseFloat(document.getElementById('umbral-valor').value) || 0;
            umbralTipo  = document.getElementById('umbral-tipo').value;
            localStorage.setItem('oltUmbralValor', umbralValor);
            localStorage.setItem('oltUmbralTipo',  umbralTipo);
            modoCargaInicial = true;
            registroNodos.clear();
            memoriaRedGlobal.clear();
            logEntradas = [];
            document.getElementById('log-list').innerHTML = '';
            actualizarPestana(oltActual, 0, false);
        };
        document.getElementById('umbral-valor').addEventListener('change', actualizarConfiguracion);
        document.getElementById('umbral-tipo').addEventListener('change', actualizarConfiguracion);

        const selectAlarma = document.getElementById('selector-alarma');
        selectAlarma.value = alarmaGuardada in AUDIOS ? alarmaGuardada : 'dosimeter';
        selectAlarma.addEventListener('change', function() {
            detenerSonido();
            sonidoAlerta = AUDIOS[this.value] || AUDIOS.alarm;
            localStorage.setItem('oltAlarmaSeleccionada', this.value);
            if ([...registroNodos.values()].some(d => !d.reconocido) && !silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});
        });

        document.getElementById('btn-test-play').onclick = () => {
            detenerSonido();
            enPrueba = true;
            sonidoAlerta.play().catch(() => {
                const statusEl = document.getElementById('mute-status');
                if (statusEl) {
                    const orig = statusEl.innerHTML;
                    statusEl.style.display = 'block'; statusEl.style.color = '#ed5565';
                    statusEl.innerHTML = '❌ Error al reproducir audio';
                    setTimeout(() => {
                        if (statusEl.innerHTML === '❌ Error al reproducir audio') {
                            statusEl.style.display = 'none'; statusEl.innerHTML = orig;
                        }
                    }, 3000);
                }
            });
            document.getElementById('btn-test-play').textContent = '🔊';
        };
        document.getElementById('btn-test-stop').onclick = () => {
            enPrueba = false;
            detenerSonido();
            document.getElementById('btn-test-play').textContent = '▶';
        };

        document.getElementById('filtro-op').addEventListener('change', function() {
            filtroOp = this.value; localStorage.setItem('oltFiltroOp', filtroOp);
        });
        document.getElementById('filtro-op').value = filtroOp;

        document.getElementById('btn-marcar-todos').onclick = () => {
            for (let data of registroNodos.values()) data.reconocido = true;
            enPrueba = false; detenerSonido();
            procesarNodos();
        };

        // --- Silenciador ---
        let clicksRapidos = 0;
        let timerClickReset = null;
        let timerMuteTemporal = null;
        let muteExpiraEn = null;

        function aplicarMuteEstado() {
            const statusEl = document.getElementById('mute-status');
            const btnSil   = document.getElementById('btn-silenciar');
            if (!statusEl || !btnSil) return;
            btnSil.classList.remove('mute-permanente', 'mute-temporal', 'mute-off');
            statusEl.classList.remove('mute-permanente', 'mute-temporal');
            statusEl.classList.add('mute-status-text');
            if (muteGlobal) {
                btnSil.classList.add('mute-permanente');
                statusEl.style.display = 'block'; statusEl.textContent = '🔒 Silencio permanente activo';
            } else if (silenciado && muteExpiraEn) {
                btnSil.classList.add('mute-temporal');
                statusEl.style.display = 'block';
                statusEl.textContent = `⏱ Silenciado ${Math.ceil((muteExpiraEn - Date.now()) / 60000)}min restantes`;
            } else {
                btnSil.classList.add('mute-off');
                statusEl.style.display = 'none'; statusEl.textContent = '';
            }
        }

        setInterval(aplicarMuteEstado, 30000);

        document.getElementById('btn-silenciar').addEventListener('click', () => {
            clicksRapidos++;
            clearTimeout(timerClickReset);
            timerClickReset = setTimeout(() => { clicksRapidos = 0; }, 3000);
            if (clicksRapidos >= 10) {
                clicksRapidos = 0; clearTimeout(timerMuteTemporal); muteExpiraEn = null;
                muteGlobal = true; silenciado = true; localStorage.setItem('oltMuteGlobal', 'true');
                enPrueba = false; detenerSonido(); aplicarMuteEstado(); return;
            }
            if (muteGlobal) {
                clicksRapidos = 0; muteGlobal = false; silenciado = false; muteExpiraEn = null;
                localStorage.setItem('oltMuteGlobal', 'false'); aplicarMuteEstado(); return;
            }
            if (silenciado && muteExpiraEn) {
                clicksRapidos = 0;
                clearTimeout(timerMuteTemporal); timerMuteTemporal = null;
                silenciado = false; muteExpiraEn = null; aplicarMuteEstado(); return;
            }
            const DURACION_MS = 60 * 60 * 1000;
            muteExpiraEn = Date.now() + DURACION_MS;
            clicksRapidos = 0;
            silenciado = true; enPrueba = false; detenerSonido();
            clearTimeout(timerMuteTemporal);
            timerMuteTemporal = setTimeout(() => { silenciado = false; muteExpiraEn = null; aplicarMuteEstado(); }, DURACION_MS);
            aplicarMuteEstado();
        });

        if (muteGlobal) aplicarMuteEstado();

        document.getElementById('btn-exportar-log').onclick = exportarLog;
        document.getElementById('btn-exportar-csv').onclick = exportarCSV;

        // --- Tabs ---
        document.getElementById('tab-alarmas').onclick = () => {
            document.getElementById('vista-alarmas').style.display = 'block';
            document.getElementById('vista-log').style.display = 'none';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-active';
            document.getElementById('tab-log').className     = 'tab-btn tab-inactive';
        };
        document.getElementById('tab-log').onclick = () => {
            document.getElementById('vista-alarmas').style.display = 'none';
            document.getElementById('vista-log').style.display = 'block';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-inactive';
            document.getElementById('tab-log').className     = 'tab-btn tab-active';
            renderizarLog();
        };
        document.getElementById('log-busqueda').addEventListener('input', function() {
            logBusqueda = this.value.trim().toLowerCase(); renderizarLog();
        });

        document.getElementById('panel-header').onclick = function(e) {
            if (e.target.id === 'btn-flotante') return;
            if (panelState === 'minimizado') {
                aplicarEstado(modoPreferido);
                panelState = modoPreferido;
            } else {
                aplicarEstado('minimizado');
                panelState = 'minimizado';
            }
        };

        document.getElementById('btn-flotante').addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) return;
            modoPreferido = panelState === 'flotante' ? 'abierto' : 'flotante';
            localStorage.setItem('oltModoPreferido', modoPreferido);
            aplicarEstado(modoPreferido);
            panelState = modoPreferido;
        });
    }

    // =========================================================
    // LOOP PRINCIPAL
    // =========================================================
    function procesarNodos() {
        if (!window.location.href.includes('/monitoring/olt/')) return;
        crearPanel();

        const oltName = document.querySelector('.olt-monitoring-details-olt-title')?.innerText.trim() || "";
        if (oltName && oltName !== oltActual) {
            oltActual = oltName; modoCargaInicial = true;
            logEntradas = []; registroNodos.clear(); memoriaRedGlobal.clear();
        }

        const filas = document.querySelectorAll('tr');

        let tablaCargada = false;
        for (let fila of filas) {
            const celdas = fila.querySelectorAll('td');
            if (celdas.length >= 2) {
                const slotStr = celdas[0].querySelector('strong')?.innerText.trim();
                if (slotStr && /^\d+$/.test(slotStr)) { tablaCargada = true; break; }
            }
        }

        if (!tablaCargada) {
            const listContainer = document.getElementById('alert-list');
            const msgCarga = '<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">⏳ Esperando datos...</div>';
            if (listContainer && ultimoHTMLRenderizado !== msgCarga) {
                listContainer.innerHTML = msgCarga;
                ultimoHTMLRenderizado = msgCarga;
                document.title = `⏳ Cargando ${oltActual}...`;
            }
            return;
        }

        const criticosActuales = [];
        let hayNovedadesParaAlarma = false;

        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            if (celdas.length < 2) return;
            const slotStrong = celdas[0].querySelector('strong');
            if (!slotStrong) return;
            const slotStr = slotStrong.innerText.trim().padStart(2, '0');
            if (!/^\d+$/.test(slotStr)) return;

            for (let i = 1; i < celdas.length; i++) {
                const celdaPort = celdas[i];
                const tituloPuerto = celdaPort.querySelector('.table-cell-head strong')?.innerText.trim() || '';
                const matchPuerto = tituloPuerto.match(/^Port\s+(\d+)$/i);
                if (!matchPuerto) continue;

                const portStr = matchPuerto[1].padStart(2, '0');
                const on  = parseInt(celdaPort.querySelector('.label-green')?.innerText)  || 0;
                const off = parseInt(celdaPort.querySelector('.label-danger')?.innerText) || 0;
                const total = on + off;
                if (total === 0) continue;

                const pDown = ((off / total) * 100).toFixed(1);
                const pUp   = ((on  / total) * 100).toFixed(1);
                const idNodo = `${oltName}${slotStr}${portStr}A`;
                const superaUmbral = umbralTipo === 'porcentaje' ? parseFloat(pDown) >= umbralValor : off >= umbralValor;

                const info      = DB_NODOS[idNodo] || { op: "---", zona: "S/I" };
                const datosNodo = { total, on, off, pDown, pUp, zona: info.zona, op: info.op };
                const memPrevia = memoriaRedGlobal.get(idNodo);
                const comoInicial = modoCargaInicial || !memPrevia;

                const etiquetas = celdaPort.querySelectorAll('.gpon-util .label');
                let labelPrincipal = null;
                if (etiquetas.length > 0) {
                    labelPrincipal = etiquetas[0];
                    labelPrincipal.innerHTML = `<div style="line-height:1.1;"><b style="font-size:11px;">${pDown}% DN</b><br><span style="font-size:9px;">${pUp}% UP</span></div>`;
                    for (let j = 1; j < etiquetas.length; j++) {
                        if (!etiquetas[j].classList.contains('label-success')) etiquetas[j].style.display = 'none';
                    }
                }

                if (superaUmbral) {
                    if (!registroNodos.has(idNodo)) {
                        const offPrev   = memPrevia ? memPrevia.off   : 0;
                        const onPrev    = memPrevia ? memPrevia.on    : total;
                        const pDownPrev = memPrevia ? memPrevia.pDown : '0';
                        registroNodos.set(idNodo, {
                            origen:        comoInicial ? 'inicial' : 'nuevo',
                            reconocido:    comoInicial,
                            timestamp:     Date.now(),
                            offAnterior:   off,
                            onAnterior:    on,
                            pDownAnterior: pDown,
                            totalAnterior: total
                        });
                        if (comoInicial) {
                            registrarLog('inicial', idNodo, datosNodo);
                        } else {
                            hayNovedadesParaAlarma = true;
                            registrarLog('nueva_alarma', idNodo, { ...datosNodo, offPrev, onPrev, pDownPrev });
                        }
                    } else {
                        const data = registroNodos.get(idNodo);
                        if (off > data.offAnterior) {
                            registrarLog('empeora', idNodo, { ...datosNodo, offAntes: data.offAnterior, onAntes: data.onAnterior, pDownAntes: data.pDownAnterior });
                            data.offAnterior = off; data.onAnterior = on; data.pDownAnterior = pDown;
                        } else if (off < data.offAnterior) {
                            registrarLog('mejora', idNodo, { ...datosNodo, offAntes: data.offAnterior, onAntes: data.onAnterior, pDownAntes: data.pDownAnterior });
                            data.offAnterior = off; data.onAnterior = on; data.pDownAnterior = pDown;
                        }
                    }

                    const data = registroNodos.get(idNodo);
                    const esNuevoParaPanel = (data.origen === 'nuevo' && !data.reconocido);

                    if (labelPrincipal) {
                        labelPrincipal.className = esNuevoParaPanel ? "label celda-acs-blink" : "label";
                        labelPrincipal.style.cssText = esNuevoParaPanel
                            ? `display:inline-block!important;width:68px!important;color:white!important;border-radius:4px;text-align:center;`
                            : `display:inline-block!important;width:68px!important;background-color:#a93226!important;color:white!important;border-radius:4px;text-align:center;border:1px solid rgba(255,255,255,0.05);`;
                    }

                    criticosActuales.push({ id: idNodo, down: pDown, off, total, ...info, esNuevoParaPanel });

                } else {
                    if (registroNodos.has(idNodo)) {
                        const data = registroNodos.get(idNodo);
                        if (!modoCargaInicial) {
                            registrarLog('recuperado', idNodo, {
                                offAntes: data.offAnterior, onAntes: data.onAnterior, pDownAntes: data.pDownAnterior,
                                offActual: off, onActual: on, pDownActual: pDown,
                                total, zona: info.zona, op: info.op
                            });
                        }
                        registroNodos.delete(idNodo);
                    }
                    if (labelPrincipal) {
                        labelPrincipal.className = "label";
                        labelPrincipal.style.cssText = `display:inline-block!important;width:68px!important;background-color:#1ab394!important;color:white!important;border-radius:4px;text-align:center;`;
                    }
                }

                memoriaRedGlobal.set(idNodo, { off, on, total, pDown });
            }
        });

        if (hayNovedadesParaAlarma && !silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});
        if (!enPrueba && criticosActuales.length === 0) detenerSonido();

        modoCargaInicial = false;

        const selectOp = document.getElementById('filtro-op');
        if (selectOp) {
            const opsEnOlt = [...new Set(criticosActuales.map(c => c.op).filter(Boolean))].sort();
            if (filtroOp !== 'TODOS' && !opsEnOlt.includes(filtroOp)) opsEnOlt.push(filtroOp);
            opsEnOlt.sort();
            const opcionesActuales = [...selectOp.options].slice(1).map(o => o.value);
            if (JSON.stringify(opsEnOlt) !== JSON.stringify(opcionesActuales)) {
                const selAnterior = selectOp.value;
                while (selectOp.options.length > 1) selectOp.remove(1);
                opsEnOlt.forEach(op => {
                    const opt = document.createElement('option');
                    opt.value = op; opt.textContent = op; selectOp.appendChild(opt);
                });
                selectOp.value = opsEnOlt.includes(selAnterior) ? selAnterior : 'TODOS';
                filtroOp = selectOp.value; localStorage.setItem('oltFiltroOp', filtroOp);
            }
        }

        const criticosFiltrados = filtroOp === 'TODOS' ? criticosActuales : criticosActuales.filter(c => c.op === filtroOp);
        const badgeContador  = document.getElementById('alert-count');
        const btnMarcar      = document.getElementById('btn-marcar-todos');
        const hayAlgoSinLeer = criticosActuales.some(c => c.esNuevoParaPanel);

        badgeContador.innerText = criticosActuales.length;
        hayAlgoSinLeer ? badgeContador.classList.add('header-blink') : badgeContador.classList.remove('header-blink');
        btnMarcar.style.display = hayAlgoSinLeer ? 'inline-block' : 'none';

        const listContainer = document.getElementById('alert-list');
        if (listContainer) {
            const nuevoHTML = criticosFiltrados.length > 0
                ? criticosFiltrados.map(c => `
                    <div class="${c.esNuevoParaPanel ? 'tarjeta-panel-blink' : ''}" style="margin-bottom:10px;padding:9px;border-left:5px solid #ed5565;background:rgba(255,255,255,0.05);border-radius:0 5px 5px 0;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <span style="color:#1ab394;font-weight:900;font-size:14px;letter-spacing:0.5px;">${c.id}</span>
                            ${c.esNuevoParaPanel ? '<span class="badge-nuevo">NUEVO</span>' : ''}
                        </div>
                        <div style="font-size:10px;color:#ddd;margin:3px 0;">📍 ${c.zona} | 🏢 ${c.op}</div>
                        <div style="margin-top:5px;color:#ed5565;font-size:11px;font-weight:bold;">
                            ⚠️ ${c.down}% caída | 🔴 OFF:${c.off} | 👥 ${c.total}
                        </div>
                    </div>`).join('')
                : criticosActuales.length > 0
                    ? `<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin alarmas para <b>${filtroOp}</b></div>`
                    : '<div style="color:#1ab394;text-align:center;padding:20px;font-weight:bold;">SISTEMA OK ✅</div>';

            if (ultimoHTMLRenderizado !== nuevoHTML) {
                listContainer.innerHTML = nuevoHTML;
                ultimoHTMLRenderizado = nuevoHTML;
            }
        }

        actualizarPestana(oltActual, criticosActuales.length, hayAlgoSinLeer);
    }

    // =========================================================
    // WORKER
    // =========================================================
    const workerBlobUrl = URL.createObjectURL(
        new Blob([`setInterval(()=>postMessage('tick'),2500)`], { type: 'application/javascript' })
    );
    const worker = new Worker(workerBlobUrl);
    URL.revokeObjectURL(workerBlobUrl);
    worker.onmessage = procesarNodos;

})();
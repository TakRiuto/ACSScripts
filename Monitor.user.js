// ==UserScript==
// @name         OLT Monitor Maestro
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/monitoring/olt/*
// @version      13.5
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
    // Guard: no ejecutar dentro de iframes del Dashboard
    if (window.self !== window.top) return;
    // --- CARGA DB ---
    let DB_NODOS = {};
    try {
        DB_NODOS = await fetch(
            'https://raw.githubusercontent.com/TakRiuto/ACSScripts/refs/heads/release/nodos.json'
        ).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        });
        console.log('✅ DB_NODOS cargado:', Object.keys(DB_NODOS).length, 'nodos');
    } catch(e) {
        console.error('❌ Error cargando nodos.json:', e);
    }

    // --- ESTADO ---
    let oltActual = "";
    let modoCargaInicial = true;
    let panelAbiertoAt = 0;
    let umbralValor = parseFloat(localStorage.getItem('oltUmbralValor')) || 30;
    let umbralTipo = localStorage.getItem('oltUmbralTipo') || 'porcentaje';
    let filtroOp = 'TODOS';

    const registroNodos = new Map();

    // --- AUDIOS DE ALARMA ---
    const AUDIOS = {
        dosimeter:    new Audio('https://actions.google.com/sounds/v1/alarms/dosimeter_alarm.ogg'),
        alarm:        new Audio('https://www.myinstants.com/media/sounds/alarm.MP3'),
        alarmabrazil: new Audio('https://www.myinstants.com/media/sounds/brazil-alarm.mp3'),
        alarmhard:    new Audio('https://www.myinstants.com/media/sounds/chicken-on-tree-screaming.mp3'),
        chevette99:   new Audio('http://soundbible.com/grab.php?id=2214&type=mp3')
    };
    // Loop nativo + precarga en todos
    Object.values(AUDIOS).forEach(a => { a.preload = 'auto'; a.loop = true; });

    // Persistir selección de alarma
    const alarmaGuardada = localStorage.getItem('oltAlarmaSeleccionada') || 'dosimeter';
    let sonidoAlerta = AUDIOS[alarmaGuardada] || AUDIOS.alarm;

    let silenciado = false;
    let muteGlobal = localStorage.getItem('oltMuteGlobal') === 'true';

    // Desbloquear todos los audios en el primer click del usuario
    let audioAutorizado = false;
    document.addEventListener('click', () => {
        if (!audioAutorizado) {
            audioAutorizado = true;
            Object.values(AUDIOS).forEach(a => {
                a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
            });
        }
    }, { once: true });

    // --- LOG ---
    let logEntradas = [];
    let vistaActual = 'alarmas';

    function timestamp() {
        const now = new Date();
        const fecha = now.toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
        const hora  = now.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        return `${fecha} ${hora}`;
    }

    function registrarLog(tipo, nodo, datos) {
        logEntradas.unshift({ tipo, nodo, datos, ts: timestamp() });
        renderizarLog();
    }

    function exportarLog() {
        const lineas = [`OLT: ${oltActual}`, `Exportado: ${timestamp()}`, '─'.repeat(60)];
        logEntradas.forEach(e => {
            const base = `[${e.ts}] ${e.nodo}`;
            if (e.tipo === 'inicial')      lineas.push(`${base} | INICIO    | Total:${e.datos.total} ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}% caída)`);
            if (e.tipo === 'nueva_alarma') lineas.push(`${base} | ALARMA    | Total:${e.datos.total} ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}% caída)`);
            if (e.tipo === 'empeora')      lineas.push(`${base} | EMPEORA   | OFF:${e.datos.offAntes}→${e.datos.off} (${e.datos.pDownAntes}%→${e.datos.pDown}%)`);
            if (e.tipo === 'recuperado')   lineas.push(`${base} | RECUPERADO| Estaba OFF:${e.datos.off} (${e.datos.pDown}%)`);
        });
        const blob = new Blob([lineas.join('\n')], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `log_${oltActual}_${new Date().toISOString().slice(0,10)}.txt`;
        a.click();
    }

    function exportarCSV() {
        // Etiquetas de estado legibles
        const ESTATUS = {
            inicial:     'INICIO',
            nueva_alarma:'ALARMA',
            empeora:     'EMPEORA',
            recuperado:  'RECUPERADO'
        };

        const encabezado = ['Fecha','Hora','OLT','Nodo','Ubicacion','Operadora','Estatus','Clientes Caidos','Clientes Caidos Antes','Clientes Totales','Porcentaje Caida'];

        const filas = logEntradas.map(e => {
            // Separar fecha y hora del timestamp "DD/MM/YYYY HH:MM:SS"
            const [fecha, hora] = e.ts.split(' ');

            const zona = e.datos.zona || '';
            const op   = e.datos.op   || '';
            const estatus = ESTATUS[e.tipo] || e.tipo;

            let caidos      = '';
            let caidosAntes = '';
            let totales     = '';
            let porcCaida   = '';

            if (e.tipo === 'inicial' || e.tipo === 'nueva_alarma') {
                caidos    = e.datos.off   ?? '';
                totales   = e.datos.total ?? '';
                porcCaida = e.datos.pDown != null ? `${e.datos.pDown}%` : '';
            } else if (e.tipo === 'empeora') {
                caidos      = e.datos.off      ?? '';
                caidosAntes = e.datos.offAntes  ?? '';
                totales     = e.datos.total     ?? '';
                porcCaida   = e.datos.pDown != null ? `${e.datos.pDown}%` : '';
            } else if (e.tipo === 'recuperado') {
                caidos    = e.datos.off   ?? '';
                porcCaida = e.datos.pDown != null ? `${e.datos.pDown}%` : '';
            }

            // Escapar campos que puedan contener comas
            const esc = v => `"${String(v).replace(/"/g, '""')}"`;

            return [
                esc(fecha), esc(hora), esc(oltActual), esc(e.nodo),
                esc(zona), esc(op), esc(estatus),
                esc(caidos), esc(caidosAntes), esc(totales), esc(porcCaida)
            ].join(',');
        });

        const csv = [encabezado.join(','), ...filas].join('\n');
        // BOM UTF-8 para que Excel lo abra correctamente con tildes
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `log_${oltActual}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
    }

    function renderizarLog() {
        const contenedor = document.getElementById('log-list');
        if (!contenedor) return;
        if (logEntradas.length === 0) {
            contenedor.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px; font-size:11px;">Sin eventos registrados.</div>';
            return;
        }
        const colores = { inicial: '#555', nueva_alarma: '#ed5565', empeora: '#e67e22', recuperado: '#1ab394' };
        const iconos  = { inicial: '📋', nueva_alarma: '🔴', empeora: '📉', recuperado: '✅' };
        const labels  = { inicial: 'INICIO', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', recuperado: 'RECUPERADO' };
        contenedor.innerHTML = logEntradas.map(e => {
            let detalle = '';
            if (e.tipo === 'inicial' || e.tipo === 'nueva_alarma')
                detalle = `Total:${e.datos.total} ON:${e.datos.on} OFF:${e.datos.off} <b>${e.datos.pDown}%↓</b>`;
            if (e.tipo === 'empeora')
                detalle = `OFF: ${e.datos.offAntes}→<b>${e.datos.off}</b> | ${e.datos.pDownAntes}%→<b>${e.datos.pDown}%</b>`;
            if (e.tipo === 'recuperado')
                detalle = `Estaba OFF:${e.datos.off} (${e.datos.pDown}%)`;
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

    // --- FAVICON ---
    let faviconEl = document.querySelector("link[rel~='icon']");
    if (!faviconEl) { faviconEl = document.createElement('link'); faviconEl.rel = 'icon'; document.head.appendChild(faviconEl); }
    const faviconCanvas = document.createElement('canvas');
    faviconCanvas.width = 32; faviconCanvas.height = 32;
    const faviconCtx = faviconCanvas.getContext('2d');

    function actualizarPestana(oltName, totalCriticos, hayNuevos) {
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

    // --- CSS ---
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes pulseACS {
            0%   { box-shadow: inset 0 0 0px #fff;  background-color: #a93226; }
            50%  { box-shadow: inset 0 0 20px #fff; background-color: #ed5565; border:1px solid #fff; }
            100% { box-shadow: inset 0 0 0px #fff;  background-color: #a93226; }
        }
        @keyframes pulsePanel {
            0%   { background-color: rgba(237,85,101,0.1); border-left:5px solid #ed5565; }
            50%  { background-color: rgba(237,85,101,0.6); border-left:5px solid #fff; }
            100% { background-color: rgba(237,85,101,0.1); border-left:5px solid #ed5565; }
        }
        .celda-acs-blink       { animation: pulseACS   0.8s infinite !important; }
        .tarjeta-panel-blink   { animation: pulsePanel 1s   infinite ease-in-out !important; }
        .badge-nuevo {
            background:#fff !important; color:#ed5565 !important;
            font-size:10px !important; font-weight:900 !important;
            padding:2px 6px !important; border-radius:4px !important;
            margin-left:8px !important; box-shadow:0 0 8px #fff;
        }
        .header-blink { animation:pulsePanel 0.4s infinite alternate !important; box-shadow:0 0 15px #ed5565 !important; }
        .ctrl {
            background:#222; color:#ed5565; border:1px solid #555;
            border-radius:3px; padding:3px 5px; font-size:11px;
            font-weight:bold; cursor:pointer; outline:none; box-sizing:border-box;
        }
        .ctrl:hover, .ctrl:focus { border-color:#ed5565; }
        input[type=number]::-webkit-inner-spin-button { opacity:1; }
        #olt-alert-panel.modo-flotante {
            left: 50% !important;
            bottom: auto !important;
            top: 50% !important;
            transform: translate(-50%, -50%);
            border-radius: 8px !important;
            border: 1px solid #555 !important;
            resize: both;
            overflow: auto;
            min-width: 320px;
            min-height: 200px;
        }
        #olt-alert-panel.modo-flotante #panel-drag-handle {
            cursor: move;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // --- PANEL ---
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
                    <span id="btn-flotante" title="Modo flotante" style="font-size:13px;cursor:pointer;opacity:0.6;user-select:none;" onclick="event.stopPropagation()">⧉</span>
                    <span id="toggle-btn" style="font-size:16px;">+</span>
                </div>
            </div>
            <div id="alert-content" style="display:none;">
                <!-- TABS -->
                <div style="display:flex;gap:4px;margin-bottom:10px;">
                    <button id="tab-alarmas" class="tab-btn tab-active">🚨 Alarmas</button>
                    <button id="tab-log"     class="tab-btn tab-inactive">📋 Log</button>
                </div>

                <!-- VISTA ALARMAS -->
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
                            <button id="btn-test-stop" class="ctrl" style="width:32px;color:#ed5565;" title="Detener prueba">■</button>
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
                            <button id="btn-silenciar" style="flex:1;background:#333;border:1px solid #555;color:#ccc;font-size:11px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;" title="Click para silenciar 60min | 5 clicks = permanente">🔇 Silenciar</button>
                        </div>
                        <div id="mute-status" style="display:none;font-size:10px;text-align:center;color:#e67e22;font-weight:bold;"></div>
                    </div>
                    <div id="alert-list" style="max-height:40vh;overflow-y:auto;scrollbar-width:thin;font-family:'Consolas',monospace;"></div>
                </div>

                <!-- VISTA LOG -->
                <div id="vista-log" style="display:none;">
                    <div style="display:flex;gap:4px;margin-bottom:8px;">
                        <button id="btn-exportar-log" style="flex:1;background:#333;border:1px solid #555;color:#aaa;font-size:10px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">⬇ .TXT</button>
                        <button id="btn-exportar-csv" style="flex:1;background:#1a3a4a;border:1px solid #1a7a9a;color:#5bc8e8;font-size:10px;font-weight:bold;padding:5px 0;border-radius:4px;cursor:pointer;">⬇ .CSV</button>
                    </div>
                    <div id="log-list" style="max-height:45vh;overflow-y:auto;scrollbar-width:thin;font-family:'Consolas',monospace;"></div>
                </div>
            </div>
        `;

        // Agregar estilos de tabs via CSS para no repetir inline
        const tabStyle = document.createElement('style');
        tabStyle.innerHTML = `
            .tab-btn { flex:1; padding:4px 0; font-size:10px; font-weight:bold; border:none; border-radius:3px; cursor:pointer; }
            .tab-active   { background:#ed5565; color:white; }
            .tab-inactive { background:#333; color:#aaa; }
        `;
        document.head.appendChild(tabStyle);

        Object.assign(panel.style, {
            position:'fixed', bottom:'20px', left:'0px', width:'120px',
            backgroundColor:'rgba(5,5,5,0.98)', color:'white', padding:'12px',
            borderRadius:'0 8px 8px 0', boxShadow:'5px 0 20px rgba(0,0,0,1)',
            zIndex:'10000', border:'1px solid #444', borderLeft:'none', transition:'width 0.2s ease'
        });
        document.body.appendChild(panel);

        // --- Valores iniciales ---
        document.getElementById('umbral-valor').value = umbralValor;
        document.getElementById('umbral-tipo').value  = umbralTipo;

        // --- Config umbral ---
        const actualizarConfiguracion = () => {
            umbralValor = parseFloat(document.getElementById('umbral-valor').value) || 0;
            umbralTipo  = document.getElementById('umbral-tipo').value;
            localStorage.setItem('oltUmbralValor', umbralValor);
            localStorage.setItem('oltUmbralTipo',  umbralTipo);
            modoCargaInicial = true;
            registroNodos.clear();
        };
        document.getElementById('umbral-valor').addEventListener('change', actualizarConfiguracion);
        document.getElementById('umbral-tipo').addEventListener('change', actualizarConfiguracion);

        // --- Selector de alarma ---
        const MAPA_ALARMA = { dosimeter:'dosimeter', alarm:'alarm', alarmabrazil:'alarmabrazil', alarmhard:'alarmhard', chevette99:'chevette99' };
        // Restaurar selección guardada
        const selectAlarma = document.getElementById('selector-alarma');
        selectAlarma.value = alarmaGuardada in MAPA_ALARMA ? alarmaGuardada : 'alarm';

        selectAlarma.addEventListener('change', function() {
            const clave = MAPA_ALARMA[this.value] || 'alarm';
            sonidoAlerta.pause();
            sonidoAlerta.currentTime = 0;
            sonidoAlerta = AUDIOS[clave];
            localStorage.setItem('oltAlarmaSeleccionada', this.value);
            // Si hay alarmas activas sin leer, arrancar el nuevo audio inmediatamente
            const hayActivas = [...registroNodos.values()].some(d => !d.reconocido);
            if (hayActivas && !silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});
        });

        // --- Botones tester ▶ ■ ---
        let enPrueba = false;
        document.getElementById('btn-test-play').onclick = () => {
            if (silenciado || muteGlobal) return; // respetar silencio
            detenerSonido();
            enPrueba = true;
            sonidoAlerta.play().catch(() => {});
            document.getElementById('btn-test-play').textContent = '🔊';
        };
        document.getElementById('btn-test-stop').onclick = () => {
            enPrueba = false;
            detenerSonido();
            document.getElementById('btn-test-play').textContent = '▶';
        };

        // --- Filtro operadora ---
        document.getElementById('filtro-op').addEventListener('change', function() { filtroOp = this.value; });

        // --- Marcar vistos ---
        document.getElementById('btn-marcar-todos').onclick = () => {
            for (let data of registroNodos.values()) data.reconocido = true;
            detenerSonido();
        };

        // --- Botón silenciar con timer y modo secreto ---
        let clicksRapidos = 0;
        let timerClickReset = null;
        let timerMuteTemporal = null;
        let muteExpiraEn = null; // timestamp absoluto

        function aplicarMuteEstado() {
            const statusEl = document.getElementById('mute-status');
            const btnSil   = document.getElementById('btn-silenciar');
            if (!statusEl || !btnSil) return;

            if (muteGlobal) {
                // Permanente
                btnSil.style.background = '#7d3c98';
                btnSil.style.borderColor = '#9b59b6';
                btnSil.style.color = 'white';
                statusEl.style.display = 'block';
                statusEl.style.color = '#9b59b6';
                statusEl.textContent = '🔒 Silencio permanente activo';
            } else if (silenciado && muteExpiraEn) {
                // Temporal: mostrar cuenta regresiva
                btnSil.style.background = '#784212';
                btnSil.style.borderColor = '#e67e22';
                btnSil.style.color = 'white';
                statusEl.style.display = 'block';
                statusEl.style.color = '#e67e22';
                const minRestantes = Math.ceil((muteExpiraEn - Date.now()) / 60000);
                statusEl.textContent = `⏱ Silenciado ${minRestantes}min restantes`;
            } else {
                // Activo / sin silencio
                btnSil.style.background = '#333';
                btnSil.style.borderColor = '#555';
                btnSil.style.color = '#ccc';
                statusEl.style.display = 'none';
            }
        }

        // Actualizar countdown cada minuto
        setInterval(aplicarMuteEstado, 30000);

        document.getElementById('btn-silenciar').addEventListener('click', () => {
            // Contar clicks rápidos para modo secreto
            clicksRapidos++;
            clearTimeout(timerClickReset);
            timerClickReset = setTimeout(() => { clicksRapidos = 0; }, 1000);

            if (clicksRapidos >= 5) {
                // MODO SECRETO — silencio permanente
                clicksRapidos = 0;
                clearTimeout(timerMuteTemporal);
                muteExpiraEn = null;
                muteGlobal = true;
                silenciado = true;
                localStorage.setItem('oltMuteGlobal', 'true');
                detenerSonido();
                aplicarMuteEstado();
                return;
            }

            if (muteGlobal) {
                // Desactivar permanente
                clicksRapidos = 0;
                muteGlobal = false;
                silenciado = false;
                muteExpiraEn = null;
                localStorage.setItem('oltMuteGlobal', 'false');
                aplicarMuteEstado();
                return;
            }

            if (silenciado && muteExpiraEn) {
                // Desactivar temporal
                clearTimeout(timerMuteTemporal);
                timerMuteTemporal = null;
                silenciado = false;
                muteExpiraEn = null;
                aplicarMuteEstado();
                return;
            }

            // Activar silencio temporal 60min
            const DURACION_MS = 60 * 60 * 1000;
            muteExpiraEn = Date.now() + DURACION_MS;
            silenciado = true;
            detenerSonido();
            clearTimeout(timerMuteTemporal);
            timerMuteTemporal = setTimeout(() => {
                silenciado = false;
                muteExpiraEn = null;
                aplicarMuteEstado();
            }, DURACION_MS);
            aplicarMuteEstado();
        });

        // Restaurar mute permanente si venía guardado
        if (muteGlobal) aplicarMuteEstado();

        // --- Exportar log ---
        document.getElementById('btn-exportar-log').onclick = exportarLog;
        document.getElementById('btn-exportar-csv').onclick = exportarCSV;

        // --- Tabs ---
        document.getElementById('tab-alarmas').onclick = () => {
            vistaActual = 'alarmas';
            document.getElementById('vista-alarmas').style.display = 'block';
            document.getElementById('vista-log').style.display = 'none';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-active';
            document.getElementById('tab-log').className     = 'tab-btn tab-inactive';
        };
        document.getElementById('tab-log').onclick = () => {
            vistaActual = 'log';
            document.getElementById('vista-alarmas').style.display = 'none';
            document.getElementById('vista-log').style.display = 'block';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-inactive';
            document.getElementById('tab-log').className     = 'tab-btn tab-active';
            renderizarLog();
        };

        // --- Toggle panel ---
        document.getElementById('panel-header').onclick = function(e) {
            if (e.target.id === 'btn-flotante') return;
            // En modo flotante no permitir minimizar
            if (modoFlotante) return;
            const content = document.getElementById('alert-content');
            const abriendo = content.style.display === 'none';
            content.style.display = abriendo ? 'block' : 'none';
            panel.style.width = abriendo ? '300px' : '120px';
            document.getElementById('toggle-btn').innerText = abriendo ? '−' : '+';
            panelAbiertoAt = abriendo ? Date.now() : 0;

            // Habilitar/deshabilitar botón flotante según estado del panel
            const btnFlotante = document.getElementById('btn-flotante');
            btnFlotante.style.opacity = abriendo ? '0.6' : '0.2';
            btnFlotante.style.pointerEvents = abriendo ? 'auto' : 'none';
        };

        // --- Modo flotante ---
        let modoFlotante = false;

        document.getElementById('btn-flotante').addEventListener('click', (e) => {
            e.stopPropagation();
            // Solo funciona si el panel está abierto
            const content = document.getElementById('alert-content');
            if (content.style.display === 'none' && !modoFlotante) return;

            modoFlotante = !modoFlotante;
            const btn = document.getElementById('btn-flotante');

            if (modoFlotante) {
                panel.classList.add('modo-flotante');
                panel.style.width = '640px';
                panel.style.left  = '50%';
                panel.style.bottom = 'auto';
                panel.style.top   = '50%';
                panel.style.borderLeft = '1px solid #555';
                panel.style.borderRadius = '8px';
                btn.title = 'Volver a anclado';
                btn.style.opacity = '1';
                // Ocultar toggle −/+ en modo flotante para que no confunda
                document.getElementById('toggle-btn').style.display = 'none';
                document.getElementById('alert-content').style.display = 'block';
            } else {
                panel.classList.remove('modo-flotante');
                panel.style.cssText = '';
                Object.assign(panel.style, {
                    position:'fixed', bottom:'20px', left:'0px', width:'300px',
                    backgroundColor:'rgba(5,5,5,0.98)', color:'white', padding:'12px',
                    borderRadius:'0 8px 8px 0', boxShadow:'5px 0 20px rgba(0,0,0,1)',
                    zIndex:'10000', border:'1px solid #444', borderLeft:'none', transition:'width 0.2s ease'
                });
                document.getElementById('toggle-btn').style.display = 'inline';
                document.getElementById('toggle-btn').innerText = '−';
                document.getElementById('alert-content').style.display = 'block';
                btn.title = 'Modo flotante';
                btn.style.opacity = '0.6';
            }
        });
    }

    function detenerSonido() {
        sonidoAlerta.pause();
        sonidoAlerta.currentTime = 0;
    }

    // --- LOOP PRINCIPAL ---
    function procesarNodos() {
        if (!window.location.href.includes('/monitoring/olt/')) return;
        crearPanel();

        const oltName = document.querySelector('.olt-monitoring-details-olt-title')?.innerText.trim() || "OLT";
        if (oltName !== oltActual) {
            oltActual = oltName;
            modoCargaInicial = true;
            logEntradas = [];
            registroNodos.clear();
        }

        const filas = document.querySelectorAll('tr');
        const criticosActuales = [];
        const ahora = Date.now();
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
                const superaUmbral = umbralTipo === 'porcentaje' ? pDown >= umbralValor : off >= umbralValor;

                const etiquetas = celdaPort.querySelectorAll('.gpon-util .label');
                let labelPrincipal = null;
                if (etiquetas.length > 0) {
                    labelPrincipal = etiquetas[0];
                    labelPrincipal.innerHTML = `<div style="line-height:1.1;"><b style="font-size:11px;">${pDown}% DN</b><br><span style="font-size:9px;">${pUp}% UP</span></div>`;
                    // Ocultar etiquetas intermedias pero preservar label-success (botón de gráfica)
                    for (let j = 1; j < etiquetas.length; j++) {
                        if (!etiquetas[j].classList.contains('label-success')) {
                            etiquetas[j].style.display = 'none';
                        }
                    }
                }

                if (superaUmbral) {
                    const info = DB_NODOS[idNodo] || { op: "---", zona: "S/I" };
                    const datosNodo = { total, on, off, pDown, pUp, zona: info.zona, op: info.op };

                    if (!registroNodos.has(idNodo)) {
                        registroNodos.set(idNodo, {
                            origen: modoCargaInicial ? 'inicial' : 'nuevo',
                            reconocido: modoCargaInicial,
                            timestamp: ahora,
                            offAnterior: off,
                            pDownAnterior: pDown
                        });
                        if (modoCargaInicial) {
                            registrarLog('inicial', idNodo, datosNodo);
                        } else {
                            hayNovedadesParaAlarma = true;
                            silenciado = false;
                            registrarLog('nueva_alarma', idNodo, datosNodo);
                        }
                    } else {
                        const data = registroNodos.get(idNodo);
                        if (off > data.offAnterior) {
                            registrarLog('empeora', idNodo, {
                                ...datosNodo,
                                offAntes: data.offAnterior,
                                pDownAntes: data.pDownAnterior
                            });
                            data.offAnterior = off;
                            data.pDownAnterior = pDown;
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
                    if (labelPrincipal) {
                        labelPrincipal.className = "label";
                        labelPrincipal.style.cssText = `display:inline-block!important;width:68px!important;background-color:#1ab394!important;color:white!important;border-radius:4px;text-align:center;`;
                    }
                }
            }
        });

        if (hayNovedadesParaAlarma && !silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});

        // Recuperados
        const idsActivos = new Set(criticosActuales.map(c => c.id));
        for (let [id, data] of registroNodos.entries()) {
            if (!idsActivos.has(id)) {
                if (!modoCargaInicial) registrarLog('recuperado', id, { off: data.offAnterior, pDown: data.pDownAnterior });
                registroNodos.delete(id);
            }
        }

        modoCargaInicial = false;

        // Poblar selector operadoras
        const selectOp = document.getElementById('filtro-op');
        if (selectOp) {
            const opsEnOlt = [...new Set(criticosActuales.map(c => c.op).filter(Boolean))].sort();
            const opcionesActuales = [...selectOp.options].slice(1).map(o => o.value);
            if (JSON.stringify(opsEnOlt) !== JSON.stringify(opcionesActuales)) {
                const selAnterior = selectOp.value;
                while (selectOp.options.length > 1) selectOp.remove(1);
                opsEnOlt.forEach(op => {
                    const opt = document.createElement('option');
                    opt.value = op; opt.textContent = op;
                    selectOp.appendChild(opt);
                });
                selectOp.value = opsEnOlt.includes(selAnterior) ? selAnterior : 'TODOS';
                filtroOp = selectOp.value;
            }
        }

        // Filtrar y renderizar
        const criticosFiltrados = filtroOp === 'TODOS' ? criticosActuales : criticosActuales.filter(c => c.op === filtroOp);
        const badgeContador = document.getElementById('alert-count');
        const btnMarcar     = document.getElementById('btn-marcar-todos');
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

            if (listContainer.innerHTML !== nuevoHTML) listContainer.innerHTML = nuevoHTML;
        }

        actualizarPestana(oltActual, criticosActuales.length, hayAlgoSinLeer);
    }

    // Worker para ticks sin throttling de pestañas inactivas
    const worker = new Worker(URL.createObjectURL(
        new Blob([`setInterval(()=>postMessage('tick'),2500)`], { type:'application/javascript' })
    ));
    worker.onmessage = procesarNodos;
})();

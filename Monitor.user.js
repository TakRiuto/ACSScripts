// ==UserScript==
// @name         OLT Monitor Maestro
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/monitoring/olt/*
// @version      10.4
// @inject-into  content
// @run-at       document-end
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/main/Monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/main/Monitor.user.js
// @grant        GM_fetch
// @connect      raw.githubusercontent.com
// ==/UserScript==

(async function() {
    'use strict';

    // --- CARGA DB ---
    let DB_NODOS = {};
    try {
        DB_NODOS = await fetch(
            'https://raw.githubusercontent.com/TakRiuto/ACSScripts/refs/heads/main/nodos.json'
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
    let panelAbiertoAt = 0; // Conservado para posible uso futuro
    let umbralValor = parseFloat(localStorage.getItem('oltUmbralValor')) || 30;
    let umbralTipo = localStorage.getItem('oltUmbralTipo') || 'porcentaje';
    let filtroOp = 'TODOS';

    const registroNodos = new Map();
    const sonidoAlerta = new Audio('http://soundbible.com/grab.php?id=2214&type=mp3');
    let silenciado = false;
    let muteGlobal = localStorage.getItem('oltMuteGlobal') === 'true';

    // Forzar autorización de audio por parte del navegador
    let audioAutorizado = false;
    document.addEventListener('click', () => {
        if (!audioAutorizado) {
            audioAutorizado = true;

            // Solo hacemos el ciclo rápido de play/pause si la alarma NO está sonando
            if (sonidoAlerta.paused) {
                sonidoAlerta.play().then(() => {
                    sonidoAlerta.pause();
                    sonidoAlerta.currentTime = 0;
                    console.log('✅ Motor de audio autorizado silenciosamente.');
                }).catch(() => {});
            } else {
                console.log('✅ Motor de audio autorizado (la alarma ya estaba activa).');
            }
        }
    }, { once: true });

    // Bucle de sonido: al terminar, se relanza si no está silenciado
    sonidoAlerta.addEventListener('ended', () => {
        if (!silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});
    });

    // --- LOG ---
    let logEntradas = [];
    let vistaActual = 'alarmas'; // 'alarmas' | 'log'

    function timestamp() {
        const now = new Date();
        const fecha = now.toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
        const hora  = now.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        return `${fecha} ${hora}`;
    }

    function registrarLog(tipo, nodo, datos) {
        // tipo: 'inicial' | 'nueva_alarma' | 'empeora' | 'recuperado'
        const entrada = { tipo, nodo, datos, ts: timestamp() };
        logEntradas.unshift(entrada); // más reciente arriba
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

    function renderizarLog() {
        const contenedor = document.getElementById('log-list');
        if (!contenedor) return;

        if (logEntradas.length === 0) {
            contenedor.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px; font-size: clamp(11px, 0.9vw, 14px);">Sin eventos registrados.</div>';
            return;
        }

        const colores = { inicial: '#555', nueva_alarma: '#ed5565', empeora: '#e67e22', recuperado: '#1ab394' };
        const iconos  = { inicial: '📋', nueva_alarma: '🔴', empeora: '📉', recuperado: '✅' };
        const labels  = { inicial: 'INICIO', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', recuperado: 'RECUPERADO' };

        contenedor.innerHTML = logEntradas.map(e => {
            let detalle = '';
            if (e.tipo === 'inicial' || e.tipo === 'nueva_alarma')
                detalle = `Total: ${e.datos.total} &nbsp;|&nbsp; ON: ${e.datos.on} &nbsp;|&nbsp; OFF: ${e.datos.off} &nbsp;|&nbsp; <b>${e.datos.pDown}% caída</b>`;
            if (e.tipo === 'empeora')
                detalle = `OFF: ${e.datos.offAntes} → <b>${e.datos.off}</b> &nbsp;|&nbsp; ${e.datos.pDownAntes}% → <b>${e.datos.pDown}%</b>`;
            if (e.tipo === 'recuperado')
                detalle = `Estaba OFF: ${e.datos.off} (${e.datos.pDown}%)`;

            return `
                <div style="margin-bottom:8px; padding:8px; border-left:4px solid ${colores[e.tipo]}; background:rgba(255,255,255,0.03); border-radius:0 4px 4px 0;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:${colores[e.tipo]}; font-size: clamp(10px, 0.8vw, 12px); font-weight:bold;">${iconos[e.tipo]} ${labels[e.tipo]}</span>
                        <span style="color:#666; font-size: clamp(8px, 0.7vw, 10px);">${e.ts}</span>
                    </div>
                    <div style="color:#ccc; font-size: clamp(11px, 0.9vw, 14px); font-weight:bold; margin:2px 0;">${e.nodo}</div>
                    <div style="color:#aaa; font-size: clamp(9px, 0.75vw, 11px);">${detalle}</div>
                </div>`;
        }).join('');
    }

    // --- FAVICON DINÁMICO ---
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
        // Título dinámico
        document.title = totalCriticos > 0
            ? `${hayNuevos ? '🆕' : '🔴'} (${totalCriticos}) ${oltName}`
            : `✅ ${oltName}`;

        // Favicon: círculo coloreado con número o check
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
            0% { box-shadow: inset 0 0 0px #fff; background-color: #a93226; }
            50% { box-shadow: inset 0 0 20px #fff; background-color: #ed5565; border: 1px solid #fff; }
            100% { box-shadow: inset 0 0 0px #fff; background-color: #a93226; }
        }
        @keyframes pulsePanel {
            0% { background-color: rgba(237, 85, 101, 0.1); border-left: 5px solid #ed5565; }
            50% { background-color: rgba(237, 85, 101, 0.6); border-left: 5px solid #fff; }
            100% { background-color: rgba(237, 85, 101, 0.1); border-left: 5px solid #ed5565; }
        }
        .celda-acs-blink { animation: pulseACS 0.8s infinite !important; }
        .tarjeta-panel-blink { animation: pulsePanel 1s infinite ease-in-out !important; }
        .badge-nuevo {
            background-color: #fff !important; color: #ed5565 !important;
            font-size: clamp(9px, 0.75vw, 11px) !important; font-weight: 900 !important;
            padding: 2px 6px !important; border-radius: 4px !important;
            margin-left: 8px !important; box-shadow: 0 0 8px #fff;
        }
        .header-blink { animation: pulsePanel 0.4s infinite alternate !important; box-shadow: 0 0 15px #ed5565 !important; }
        .control-umbral {
            background: #222; color: #ed5565; border: 1px solid #555;
            border-radius: 3px; padding: 3px 5px; font-size: clamp(10px, 0.8vw, 12px);
            font-weight: bold; cursor: pointer; outline: none; box-sizing: border-box;
        }
        .control-umbral:hover, .control-umbral:focus { border-color: #ed5565; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
    `;
    (document.head || document.documentElement).appendChild(style);

    // --- PANEL ---
    function crearPanel() {
        if (document.getElementById('olt-alert-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'olt-alert-panel';
        panel.innerHTML = `
            <div id="panel-header" style="cursor:pointer; font-weight:bold; border-bottom:1px solid #ed5565; margin-bottom:10px; padding-bottom:5px; font-size: clamp(13px, 1.1vw, 16px); color:#ed5565; display:flex; justify-content:space-between; align-items:center;">
                <span id="header-text">🚨 <span id="alert-count" style="background:#ed5565; color:white; border-radius:10px; padding:0 8px; font-size: clamp(11px, 0.9vw, 14px);">0</span></span>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span id="toggle-btn" style="font-size: clamp(14px, 1.2vw, 18px);">+</span>
                </div>
            </div>
            <div id="alert-content" style="display: none;">
                <div style="display:flex; gap:4px; margin-bottom:10px;">
                    <button id="tab-alarmas" style="flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#ed5565; color:white;">🚨 Alarmas</button>
                    <button id="tab-log"     style="flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#333; color:#aaa;">📋 Log</button>
                </div>

                <div id="vista-alarmas">
                    <div style="background: rgba(255,255,255,0.05); padding: 8px; margin-bottom: 10px; border-radius: 4px; display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size: clamp(9px, 0.75vw, 12px); color:#aaa; font-weight:bold;">TIPO DE ALARMA:</span>
                            <label style="font-size: clamp(9px, 0.75vw, 12px); color:#ccc; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px;" title="Silenciar alertas globalmente">
                                <input type="checkbox" id="toggle-mute-global" style="margin:0; cursor:pointer;"> 🔇 Silenciar
                            </label>
                        </div>
                        <div style="display:flex; justify-content:space-between; gap: 5px;">
                            <select id="umbral-tipo" class="control-umbral" style="flex: 1;">
                                <option value="porcentaje">Porcentaje (%)</option>
                                <option value="cantidad">Cant. Caídos</option>
                            </select>
                            <input type="number" id="umbral-valor" class="control-umbral" style="width: 55px; text-align:center;" min="1" max="999">
                        </div>
                        <span style="font-size: clamp(9px, 0.75vw, 12px); color:#aaa; font-weight:bold;">OPERADORA:</span>
                        <select id="filtro-op" class="control-umbral" style="width:100%;">
                            <option value="TODOS">— Todas —</option>
                        </select>
                        <button id="btn-marcar-todos" style="display:none; width:100%; background:#1ab394; border:none; color:white; font-size: clamp(11px, 0.9vw, 14px); font-weight:bold; padding:5px 0; border-radius:4px; cursor:pointer;">✔ Marcar todos como vistos</button>
                    </div>
                    <div id="alert-list" style="max-height: 40vh; overflow-y:auto; scrollbar-width: thin; font-family: 'Consolas', monospace;"></div>
                </div>

                <div id="vista-log" style="display:none;">
                    <button id="btn-exportar-log" style="width:100%; background:#333; border:1px solid #555; color:#aaa; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; padding:5px 0; border-radius:4px; cursor:pointer; margin-bottom:8px;">⬇ Exportar Log (.txt)</button>
                    <div id="log-list" style="max-height: 45vh; overflow-y:auto; scrollbar-width: thin; font-family: 'Consolas', monospace;"></div>
                </div>
            </div>
        `;
        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', left: '0px', width: '120px',
            backgroundColor: 'rgba(5, 5, 5, 0.98)', color: 'white', padding: '12px',
            borderRadius: '0 8px 8px 0', boxShadow: '5px 0 20px rgba(0,0,0,1)', zIndex: '10000',
            border: '1px solid #444', borderLeft: 'none', transition: 'width 0.2s ease'
        });
        document.body.appendChild(panel);

        const inputValor = document.getElementById('umbral-valor');
        const selectTipo = document.getElementById('umbral-tipo');
        inputValor.value = umbralValor;
        selectTipo.value = umbralTipo;
        const checkMuteGlobal = document.getElementById('toggle-mute-global');
        if (checkMuteGlobal) {
            checkMuteGlobal.checked = muteGlobal;
            checkMuteGlobal.addEventListener('change', (e) => {
                muteGlobal = e.target.checked;
                localStorage.setItem('oltMuteGlobal', muteGlobal);
                if (muteGlobal) {
                    sonidoAlerta.pause();
                    sonidoAlerta.currentTime = 0;
                }
            });
        }
        const actualizarConfiguracion = () => {
            umbralValor = parseFloat(inputValor.value) || 0;
            umbralTipo = selectTipo.value;
            localStorage.setItem('oltUmbralValor', umbralValor);
            localStorage.setItem('oltUmbralTipo', umbralTipo);
            modoCargaInicial = true;
            registroNodos.clear();
        };

        inputValor.addEventListener('change', actualizarConfiguracion);
        selectTipo.addEventListener('change', actualizarConfiguracion);

        document.getElementById('filtro-op').addEventListener('change', function() {
            filtroOp = this.value;
        });

        document.getElementById('btn-marcar-todos').onclick = () => {
            for (let data of registroNodos.values()) data.reconocido = true;
            silenciado = true;
            sonidoAlerta.pause();
            sonidoAlerta.currentTime = 0;
        };

        document.getElementById('btn-exportar-log').onclick = exportarLog;

        document.getElementById('tab-alarmas').onclick = () => {
            vistaActual = 'alarmas';
            document.getElementById('vista-alarmas').style.display = 'block';
            document.getElementById('vista-log').style.display = 'none';
            document.getElementById('tab-alarmas').style.cssText = 'flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#ed5565; color:white;';
            document.getElementById('tab-log').style.cssText     = 'flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#333; color:#aaa;';
        };

        document.getElementById('tab-log').onclick = () => {
            vistaActual = 'log';
            document.getElementById('vista-alarmas').style.display = 'none';
            document.getElementById('vista-log').style.display = 'block';
            document.getElementById('tab-alarmas').style.cssText = 'flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#333; color:#aaa;';
            document.getElementById('tab-log').style.cssText     = 'flex:1; padding:4px 0; font-size: clamp(9px, 0.75vw, 12px); font-weight:bold; border:none; border-radius:3px; cursor:pointer; background:#1ab394; color:white;';
            renderizarLog();
        };

        document.getElementById('panel-header').onclick = function() {
            const content = document.getElementById('alert-content');
            const abriendo = content.style.display === 'none';
            content.style.display = abriendo ? 'block' : 'none';
            document.getElementById('olt-alert-panel').style.width = abriendo ? '450px' : '120px';
            document.getElementById('toggle-btn').innerText = abriendo ? '−' : '+';
            panelAbiertoAt = abriendo ? Date.now() : 0;
        };
    }

    // --- LOOP PRINCIPAL ---
    function procesarNodos() {
        if (!window.location.href.includes('/monitoring/olt/')) return;
        crearPanel();

        const oltName = document.querySelector('.olt-monitoring-details-olt-title')?.innerText.trim() || "OLT";

        // Si cambia la OLT, invalidar todo el cache
        if (oltName !== oltActual) {
            oltActual = oltName;
            modoCargaInicial = true;
            logEntradas = [];
            registroNodos.clear();
        }

        // Escanear filas directamente — tabla máx 15x16, costo negligible
        const filas = document.querySelectorAll('tr');

        const criticosActuales = [];
        const ahora = Date.now();
        let hayNovedadesParaAlarma = false;

        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            if (celdas.length < 17) return;
            const slotStr = celdas[0].innerText.trim().padStart(2, '0');
            if (!/^\d+$/.test(slotStr)) return;

            for (let pIdx = 0; pIdx < 16; pIdx++) {
                const celdaPort = celdas[pIdx + 1];
                if (!celdaPort) continue;

                const on = parseInt(celdaPort.querySelector('.label-green')?.innerText) || 0;
                const off = parseInt(celdaPort.querySelector('.label-danger')?.innerText) || 0;
                const total = on + off;
                if (total === 0) continue;

                const pDown = ((off / total) * 100).toFixed(1);
                const pUp = ((on / total) * 100).toFixed(1);
                const idNodo = `${oltName}${slotStr}${pIdx.toString().padStart(2, '0')}A`;

                const superaUmbral = umbralTipo === 'porcentaje' ? pDown >= umbralValor : off >= umbralValor;

                const etiquetas = celdaPort.querySelectorAll('.gpon-util .label');
                let labelPrincipal = null;

                if (etiquetas.length > 0) {
                    labelPrincipal = etiquetas[0];
                    // También ajustamos los textos inyectados en la tabla principal para que escalen sutilmente
                    labelPrincipal.innerHTML = `<div style="line-height:1.1;"><b style="font-size: 11px;">${pDown}% DN</b><br><span style="font-size: 9px;">${pUp}% UP</span></div>`;
                    for (let i = 1; i < etiquetas.length; i++) etiquetas[i].style.display = 'none';
                }

                if (superaUmbral) {
                    const info = DB_NODOS[idNodo] || { op: "---", zona: "S/I" };
                    const datosNodo = { total, on, off, pDown, pUp };

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
                        if (esNuevoParaPanel) {
                            labelPrincipal.className = "label celda-acs-blink";
                            labelPrincipal.style.cssText = `display:inline-block!important;width:68px!important;color:white!important;border-radius:4px;text-align:center;`;
                        } else {
                            labelPrincipal.className = "label";
                            labelPrincipal.style.cssText = `display:inline-block!important;width:68px!important;background-color:#a93226!important;color:white!important;border-radius:4px;text-align:center;border:1px solid rgba(255,255,255,0.1);`;
                        }
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

        // Limpiar nodos que ya no están activos y registrar recuperación
        const idsActivos = new Set(criticosActuales.map(c => c.id));
        for (let [id, data] of registroNodos.entries()) {
            if (!idsActivos.has(id)) {
                if (!modoCargaInicial) {
                    registrarLog('recuperado', id, {
                        off: data.offAnterior,
                        pDown: data.pDownAnterior
                    });
                }
                registroNodos.delete(id);
            }
        }

        modoCargaInicial = false;

        // Poblar selector de operadoras con las disponibles en criticosActuales
        const selectOp = document.getElementById('filtro-op');
        if (selectOp) {
            const opsEnOlt = [...new Set(criticosActuales.map(c => c.op).filter(Boolean))].sort();
            const opcionesActuales = [...selectOp.options].slice(1).map(o => o.value);
            const cambiaOps = JSON.stringify(opsEnOlt) !== JSON.stringify(opcionesActuales);
            if (cambiaOps) {
                // Conservar selección actual si sigue disponible
                const selAnterior = selectOp.value;
                while (selectOp.options.length > 1) selectOp.remove(1);
                opsEnOlt.forEach(op => {
                    const opt = document.createElement('option');
                    opt.value = op;
                    opt.textContent = op;
                    selectOp.appendChild(opt);
                });
                selectOp.value = opsEnOlt.includes(selAnterior) ? selAnterior : 'TODOS';
                filtroOp = selectOp.value;
            }
        }

        // Aplicar filtro de operadora
        const criticosFiltrados = filtroOp === 'TODOS'
            ? criticosActuales
            : criticosActuales.filter(c => c.op === filtroOp);

        // Actualizar badge — siempre refleja el total real, no el filtrado
        const badgeContador = document.getElementById('alert-count');
        const btnMarcar = document.getElementById('btn-marcar-todos');
        const hayAlgoSinLeer = criticosActuales.some(c => c.esNuevoParaPanel);
        badgeContador.innerText = criticosActuales.length;
        hayAlgoSinLeer ? badgeContador.classList.add('header-blink') : badgeContador.classList.remove('header-blink');
        btnMarcar.style.display = hayAlgoSinLeer ? 'inline-block' : 'none';

        // Actualizar lista con los nodos filtrados
        const listContainer = document.getElementById('alert-list');
        if (listContainer) {
            const nuevoHTML = criticosFiltrados.length > 0
                ? criticosFiltrados.map(c => `
                    <div class="${c.esNuevoParaPanel ? 'tarjeta-panel-blink' : ''}" style="margin-bottom:12px; padding:10px; border-left:5px solid #ed5565; background:rgba(255,255,255,0.03); border-radius:0 5px 5px 0;">
                        <div style="display:flex; align-items:center; justify-content:space-between;">
                            <span style="color:#1ab394; font-weight:900; font-size: clamp(13px, 1.2vw, 18px); letter-spacing:0.5px;">${c.id}</span>
                            ${c.esNuevoParaPanel ? '<span class="badge-nuevo">NUEVO</span>' : ''}
                        </div>
                        <div style="font-size: clamp(9px, 0.75vw, 12px); color:#ddd; margin: 3px 0;">📍 ${c.zona} | 🏢 ${c.op}</div>
                        <div style="margin-top:6px; color:#ed5565; font-size: clamp(10px, 0.8vw, 12px); font-weight:bold;">
                            ⚠️ CAÍDA: ${c.down}% | 🔴 OFF: ${c.off} | 👥 TOTAL: ${c.total}
                        </div>
                    </div>`).join('')
                : criticosActuales.length > 0
                    ? `<div style="color:#aaa; text-align:center; padding:20px; font-size: clamp(11px, 0.9vw, 14px);">Sin alarmas para <b>${filtroOp}</b></div>`
                    : '<div style="color:#1ab394; text-align:center; padding:20px; font-weight:bold; font-size: clamp(12px, 1vw, 15px);">SISTEMA OK ✅</div>';

            if (listContainer.innerHTML !== nuevoHTML) listContainer.innerHTML = nuevoHTML;
        }

        // Actualizar título y favicon de la pestaña
        actualizarPestana(oltActual, criticosActuales.length, hayAlgoSinLeer);
    }
    const workerCode = `
      setInterval(() => {
          postMessage('tick');
      }, 2500);
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));

  worker.onmessage = function() {
      procesarNodos();
};
})();

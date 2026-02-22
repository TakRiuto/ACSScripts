// ==UserScript==
// @name         OLT Monitor Maestro
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/monitoring/olt/*
// @version      8.3
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
    let panelAbiertoAt = 0;
    let filasCache = null; // Cache de filas DOM

    let umbralValor = parseFloat(localStorage.getItem('oltUmbralValor')) || 30;
    let umbralTipo = localStorage.getItem('oltUmbralTipo') || 'porcentaje';

    const registroNodos = new Map();
    const TIEMPO_LECTURA_MS = 30000;
    const sonidoAlerta = new Audio('http://soundbible.com/grab.php?id=2214&type=mp3');

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
            font-size: 10px !important; font-weight: 900 !important;
            padding: 2px 6px !important; border-radius: 4px !important;
            margin-left: 8px !important; box-shadow: 0 0 8px #fff;
        }
        .header-blink { animation: pulsePanel 0.4s infinite alternate !important; box-shadow: 0 0 15px #ed5565 !important; }
        .control-umbral {
            background: #222; color: #ed5565; border: 1px solid #555;
            border-radius: 3px; padding: 3px 5px; font-size: 11px;
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
            <div id="panel-header" style="cursor:pointer; font-weight:bold; border-bottom:1px solid #ed5565; margin-bottom:10px; padding-bottom:5px; font-size:13px; color:#ed5565; display:flex; justify-content:space-between; align-items:center;">
                <span id="header-text">🚨 <span id="alert-count" style="background:#ed5565; color:white; border-radius:10px; padding:0 8px; font-size:11px;">0</span></span>
                <span id="toggle-btn" style="font-size:16px;">+</span>
            </div>
            <div id="alert-content" style="display: none;">
                <div style="background: rgba(255,255,255,0.05); padding: 8px; margin-bottom: 10px; border-radius: 4px; display:flex; flex-direction:column; gap:6px;">
                    <span style="font-size:10px; color:#aaa; font-weight:bold;">TIPO DE ALARMA:</span>
                    <div style="display:flex; justify-content:space-between; gap: 5px;">
                        <select id="umbral-tipo" class="control-umbral" style="flex: 1;">
                            <option value="porcentaje">Porcentaje (%)</option>
                            <option value="cantidad">Cant. Caídos</option>
                        </select>
                        <input type="number" id="umbral-valor" class="control-umbral" style="width: 55px; text-align:center;" min="1" max="999">
                    </div>
                </div>
                <div id="alert-list" style="max-height:410px; overflow-y:auto; scrollbar-width: thin; font-family: 'Consolas', monospace;"></div>
            </div>
        `;
        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', left: '0px', width: '100px',
            backgroundColor: 'rgba(5, 5, 5, 0.98)', color: 'white', padding: '12px',
            borderRadius: '0 8px 8px 0', boxShadow: '5px 0 20px rgba(0,0,0,1)', zIndex: '10000',
            border: '1px solid #444', borderLeft: 'none', transition: 'width 0.2s ease'
        });
        document.body.appendChild(panel);

        const inputValor = document.getElementById('umbral-valor');
        const selectTipo = document.getElementById('umbral-tipo');
        inputValor.value = umbralValor;
        selectTipo.value = umbralTipo;

        const actualizarConfiguracion = () => {
            umbralValor = parseFloat(inputValor.value) || 0;
            umbralTipo = selectTipo.value;
            localStorage.setItem('oltUmbralValor', umbralValor);
            localStorage.setItem('oltUmbralTipo', umbralTipo);
            modoCargaInicial = true;
            filasCache = null; // Invalida cache al cambiar configuración
            registroNodos.clear();
        };

        inputValor.addEventListener('change', actualizarConfiguracion);
        selectTipo.addEventListener('change', actualizarConfiguracion);

        document.getElementById('panel-header').onclick = function() {
            const content = document.getElementById('alert-content');
            const abriendo = content.style.display === 'none';
            content.style.display = abriendo ? 'block' : 'none';
            document.getElementById('olt-alert-panel').style.width = abriendo ? '260px' : '100px';
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
            filasCache = null;
            registroNodos.clear();
        }

        // Usar cache de filas si existe, si no, escanear y cachear
        const filas = filasCache || document.querySelectorAll('tr');
        if (!filasCache) filasCache = filas;

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
                    labelPrincipal.innerHTML = `<div style="line-height:1.1;"><b style="font-size:11px;">${pDown}% DN</b><br><span style="font-size:9px;">${pUp}% UP</span></div>`;
                    for (let i = 1; i < etiquetas.length; i++) etiquetas[i].style.display = 'none';
                }

                if (superaUmbral) {
                    if (!registroNodos.has(idNodo)) {
                        registroNodos.set(idNodo, {
                            origen: modoCargaInicial ? 'inicial' : 'nuevo',
                            reconocido: modoCargaInicial,
                            timestamp: ahora
                        });
                        if (!modoCargaInicial) hayNovedadesParaAlarma = true;
                    }

                    const data = registroNodos.get(idNodo);
                    if (panelAbiertoAt > 0 && (ahora - panelAbiertoAt) > TIEMPO_LECTURA_MS) data.reconocido = true;

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

                    const info = DB_NODOS[idNodo] || { op: "---", zona: "S/I" };
                    criticosActuales.push({ id: idNodo, down: pDown, off, ...info, esNuevoParaPanel });

                } else {
                    if (labelPrincipal) {
                        labelPrincipal.className = "label";
                        labelPrincipal.style.cssText = `display:inline-block!important;width:68px!important;background-color:#1ab394!important;color:white!important;border-radius:4px;text-align:center;`;
                    }
                }
            }
        });

        if (hayNovedadesParaAlarma) sonidoAlerta.play().catch(() => {});

        // Limpiar nodos que ya no están activos
        const idsActivos = new Set(criticosActuales.map(c => c.id));
        for (let id of registroNodos.keys()) { if (!idsActivos.has(id)) registroNodos.delete(id); }

        modoCargaInicial = false;

        // Actualizar badge
        const badgeContador = document.getElementById('alert-count');
        const hayAlgoSinLeer = criticosActuales.some(c => c.esNuevoParaPanel);
        badgeContador.innerText = criticosActuales.length;
        hayAlgoSinLeer ? badgeContador.classList.add('header-blink') : badgeContador.classList.remove('header-blink');

        // Actualizar lista solo si el contenido cambió
        const listContainer = document.getElementById('alert-list');
        if (listContainer) {
            const nuevoHTML = criticosActuales.length > 0
                ? criticosActuales.map(c => `
                    <div class="${c.esNuevoParaPanel ? 'tarjeta-panel-blink' : ''}" style="margin-bottom:12px; padding:10px; border-left:5px solid #ed5565; background:rgba(237,85,101,0.1); border-radius:0 5px 5px 0;">
                        <div style="display:flex; align-items:center; justify-content:space-between;">
                            <span style="color:#1ab394; font-weight:900; font-size:15px; letter-spacing:0.5px;">${c.id}</span>
                            ${c.esNuevoParaPanel ? '<span class="badge-nuevo">NUEVO</span>' : ''}
                        </div>
                        <div style="font-size:11px; color:#ddd; margin: 3px 0;">📍 ${c.zona} | 🏢 ${c.op}</div>
                        <div style="margin-top:6px; color:#ed5565; font-size:12px; font-weight:bold;">
                            ⚠️ CAÍDA: ${c.down}% | 🔴 OFF: ${c.off}
                        </div>
                    </div>`).join('')
                : '<div style="color:#1ab394; text-align:center; padding:20px; font-weight:bold;">SISTEMA OK ✅</div>';

            if (listContainer.innerHTML !== nuevoHTML) listContainer.innerHTML = nuevoHTML;
        }

        // Actualizar título y favicon de la pestaña
        actualizarPestana(oltActual, criticosActuales.length, hayAlgoSinLeer);
    }

    setInterval(procesarNodos, 2500);
})();

// ==UserScript==
// @name         OLT Monitor Maestro
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/monitoring/olt/*
// @version      16.7
// @run-at       document-end
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/Monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/Monitor.user.js
// @grant        none
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(async function () {
    'use strict';
    if (window.self !== window.top) return;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // =========================================================
    // DB
    // =========================================================
    let DB_NODOS = {};
    let dbCargada = true;
    try {
        const resp = await fetch(`https://raw.githubusercontent.com/TakRiuto/ACSScripts/refs/heads/release/nodos.json?t=${Date.now()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        DB_NODOS = await resp.json();
        console.log('✅ DB_NODOS cargado:', Object.keys(DB_NODOS).length, 'nodos');
    } catch (e) {
        console.error('❌ Error cargando nodos.json:', e);
        dbCargada = false;
    }

    // =========================================================
    // ESTADO
    // =========================================================
    const resultadosRCA = new Map();
    const RCA_TIMEOUT_MS = 10000;
    const RCA_VALIDAS = new Set(['LOS', 'LOSi', 'LOFi', 'link-down']);
    const CAUSAS_CONOCIDAS = {
        'dying-gasp': { titulo: 'Pérdida de alimentación eléctrica', icono: '⚡' },
        'LOS':        { titulo: 'Loss of Signal — Pérdida de señal óptica', icono: '🔴' },
        'LOSi':       { titulo: 'Loss of Signal — Pérdida de señal óptica (intermitente)', icono: '🟡' },
        'power-off':  { titulo: 'Apagado de equipo', icono: '🔌' },
        'link-down':  { titulo: 'Enlace caído', icono: '🔗' },
        'deactive':   { titulo: 'Falso positivo (deuda/desconexión adm.)', icono: '💡' },
        'LOFi':       { titulo: 'Loss of Frame — Pérdida de trama', icono: '🔗' },
        'SUSPENDED':  { titulo: 'Suspendido (Admin)', icono: '🚫' },
        'OTHER':      { titulo: 'Falla Desconocida', icono: '❓' }
    };

    let oltActual = '';
    let oltSessionId = 0;
    let oltAbortController = new AbortController();
    let modoCargaInicial = true;

    const savedUmbral = parseFloat(localStorage.getItem('oltUmbralValor'));
    let umbralValor = Number.isFinite(savedUmbral) && savedUmbral >= 1 ? savedUmbral : 30;
    let umbralTipo = localStorage.getItem('oltUmbralTipo') || 'porcentaje';
    let filtroOp = localStorage.getItem('oltFiltroOp') || 'TODOS';
    let logBusqueda = '';
    let escala = parseFloat(localStorage.getItem('oltPanelEscala')) || 1;
    let panelState = 'minimizado';
    let modoPreferido = localStorage.getItem('oltModoPreferido') || 'abierto';

    let ultimoHTMLRenderizado = '';
    let ultimoEstadoPestana = { oltName: '', criticos: -1, hayNuevos: null };
    let cachedToken = '';

    const registroNodos = new Map();
    const memoriaRedGlobal = new Map();

    function _oltNormCausa(raw) {
        if (!raw || raw === '-') return null;
        const k = raw.trim();
        if (k === 'LOBi' || k === 'LOSi/LOBi' || k === 'LOBi/LOSi' || k.includes('LOSi')) return 'LOSi';
        if (k.toUpperCase() === 'LOFI') return 'LOFi';
        return k;
    }

    function obtenerTokenAcs(forceRefresh = false) {
        if (cachedToken && !forceRefresh) return cachedToken;

        // Camino rápido (ACS estándar)
        try {
            const rawUser = localStorage.getItem('currentUser');
            if (rawUser) {
                const tokenId = JSON.parse(rawUser)?.token?.id;
                if (typeof tokenId === 'string' && tokenId.length > 0) {
                    cachedToken = tokenId;
                    return cachedToken;
                }
            }
        } catch {}

        const isJwt = (v) => typeof v === 'string' && v.startsWith('eyJ') && v.split('.').length >= 3;

        const traverse = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 6) return null;
            for (const val of Object.values(obj)) {
                if (isJwt(val)) return val;
                if (val && typeof val === 'object') {
                    const found = traverse(val, depth + 1);
                    if (found) return found;
                }
            }
            return null;
        };

        for (const storage of [localStorage, sessionStorage]) {
            for (let i = 0; i < storage.length; i++) {
                const val = storage.getItem(storage.key(i));
                if (!val) continue;
                if (isJwt(val)) { cachedToken = val; return cachedToken; }
                if (val.includes('eyJ')) {
                    try {
                        const found = traverse(JSON.parse(val));
                        if (found) { cachedToken = found; return cachedToken; }
                    } catch {}
                }
            }
        }

        for (const c of document.cookie.split(';')) {
            const eqIdx = c.indexOf('=');
            if (eqIdx === -1) continue;
            const val = c.slice(eqIdx + 1).trim();
            if (isJwt(val)) { cachedToken = val; return cachedToken; }
        }

        cachedToken = '';
        return '';
    }

    async function ejecutarRCA(idNodo, oltId, slotId, portId, offSnap, onSnap) {
        if (!oltId) return;

        const sessionId = oltSessionId;
        const token = obtenerTokenAcs();

        resultadosRCA.set(idNodo, {
            status: 'loading',
            msg: '⏳ Analizando causa raíz...',
            off: offSnap,
            on: onSnap,
            ts: Date.now()
        });

        if (!token) {
            resultadosRCA.set(idNodo, {
                status: 'error',
                msg: '🔑 Sin Token de Auth para RCA',
                off: offSnap,
                on: onSnap,
                ts: Date.now()
            });
            return;
        }

        const reqController = new AbortController();
        const onOltAbort = () => reqController.abort();
        oltAbortController.signal.addEventListener('abort', onOltAbort, { once: true });
        const timeoutTimer = setTimeout(() => reqController.abort(), RCA_TIMEOUT_MS);

        try {
            const filterObj = {
                skip: 0,
                limit: 100,
                where: {
                    and: [
                        { slotId: slotId.toString() },
                        { portId: portId.toString() },
                        { generalStatus: 'OFFLINE' }
                    ]
                }
            };
            const filter = encodeURIComponent(JSON.stringify(filterObj));
            const url = `${window.location.origin}/api/fttx/olts/${oltId}/active-devices?filter=${filter}`;

            const res = await fetch(url, {
                headers: {
                    'accept': 'application/json',
                    'x-access-token': token
                },
                signal: reqController.signal
            });

            if (sessionId !== oltSessionId) return;

            if (res.status === 401 || res.status === 403) {
                cachedToken = '';
                throw new Error(`Auth HTTP ${res.status}`);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            if (sessionId !== oltSessionId) return;

            if (!Array.isArray(data) || data.length === 0) {
                resultadosRCA.set(idNodo, {
                    status: 'done',
                    msg: '🦕 Sin reporte de falla en OLT',
                    off: offSnap,
                    on: onSnap,
                    ts: Date.now()
                });
                return;
            }

            const causasCount = {};
            let validCount = 0;

            for (const ont of data) {
                const raw = (ont.lastDownCause && ont.lastDownCause.trim() !== '-') ? ont.lastDownCause.trim() : null;
                const causa = _oltNormCausa(raw);
                if (causa) {
                    causasCount[causa] = (causasCount[causa] || 0) + 1;
                    validCount++;
                }
            }

            if (validCount === 0) {
                resultadosRCA.set(idNodo, {
                    status: 'done',
                    msg: '🦕 Caída sin diagnóstico',
                    off: offSnap,
                    on: onSnap,
                    ts: Date.now()
                });
                return;
            }

            let dominante = null;
            let max = 0;
            for (const [c, cnt] of Object.entries(causasCount)) {
                if (cnt > max) { max = cnt; dominante = c; }
            }

            const pct = Math.round((max / validCount) * 100);
            const info = CAUSAS_CONOCIDAS[dominante] || { titulo: dominante, icono: '⚠️' };

            let desglose = '';
            if (Object.keys(causasCount).length > 1) {
                const porcentajes = {};
                const restos = [];
                let suma = 0;
                for (const [mot, cnt] of Object.entries(causasCount)) {
                    const pctExacto = (cnt / validCount) * 100;
                    const pctEntero = Math.floor(pctExacto);
                    porcentajes[mot] = pctEntero;
                    suma += pctEntero;
                    restos.push({ mot, resto: pctExacto - pctEntero });
                }
                restos.sort((a, b) => b.resto - a.resto);
                const faltante = 100 - suma;
                for (let i = 0; i < faltante; i++) {
                    porcentajes[restos[i].mot]++;
                }
                const partes = [];
                for (const [mot, pctVal] of Object.entries(porcentajes)) {
                    if (pctVal > 0) partes.push(`${mot}: ${pctVal}%`);
                }
                desglose = partes.join(' · ');
            }

            resultadosRCA.set(idNodo, {
                status: 'done',
                dominante,
                msg: `${info.icono} RCA: ${info.titulo} (${pct}%)`,
                desglose,
                off: offSnap,
                on: onSnap,
                ts: Date.now()
            });
        } catch (e) {
            if (sessionId !== oltSessionId) return;
            console.error('Error en RCA para', idNodo, e);
            resultadosRCA.set(idNodo, {
                status: 'error',
                msg: e.name === 'AbortError' ? '⏱️ Timeout en consulta RCA' : '❌ Falla comunicación RCA',
                off: offSnap,
                on: onSnap,
                ts: Date.now()
            });
        } finally {
            clearTimeout(timeoutTimer);
            oltAbortController.signal.removeEventListener('abort', onOltAbort);
        }
    }

    function renderRcaHtml(rcaData) {
        if (!rcaData) return '';
        const mainText = escapeHtml(rcaData.msg || '');
        const subText = rcaData.desglose
            ? `<br><span style="font-size:9px;color:#ccc;display:block;margin-top:2px;">[ ${escapeHtml(rcaData.desglose)} ]</span>`
            : '';
        return `<div style="margin-top:4px;font-size:11px;color:#f1c40f;background:rgba(0,0,0,0.2);padding:4px 6px;border-radius:4px;display:inline-block;letter-spacing:0.3px;">${mainText}${subText}</div>`;
    }

    // =========================================================
    // AUDIO
    // =========================================================
    const AUDIO_URLS = {
        dosimeter:    'https://actions.google.com/sounds/v1/alarms/dosimeter_alarm.ogg',
        alarm:        'https://www.myinstants.com/media/sounds/alarm.MP3',
        alarmabrazil: 'https://www.myinstants.com/media/sounds/brazil-alarm.mp3',
        alarmhard:    'https://www.myinstants.com/media/sounds/chicken-on-tree-screaming.mp3',
        chevette99:   'https://soundbible.com/grab.php?id=2214&type=mp3'
    };
    const AUDIOS = {};
    function getAudio(key) {
        const validKey = key in AUDIO_URLS ? key : 'dosimeter';
        if (!AUDIOS[validKey]) {
            const a = new Audio(AUDIO_URLS[validKey]);
            a.preload = 'auto';
            a.loop = true;
            AUDIOS[validKey] = a;
        }
        return AUDIOS[validKey];
    }

    const alarmaGuardada = localStorage.getItem('oltAlarmaSeleccionada') || 'dosimeter';
    let sonidoAlerta = getAudio(alarmaGuardada);

    let silenciado = false;
    let muteGlobal = localStorage.getItem('oltMuteGlobal') === 'true';
    let enPrueba = false;
    let audioAutorizado = false;

    function desbloquearAudio(audioObj) {
        if (audioAutorizado) return;
        audioAutorizado = true;
        audioObj.play().then(() => {
            audioObj.pause();
            audioObj.currentTime = 0;
        }).catch(() => {});
    }

    document.addEventListener('click', () => desbloquearAudio(sonidoAlerta), { once: true });

    function detenerSonido() {
        sonidoAlerta.pause();
        sonidoAlerta.currentTime = 0;
        const btnPlay = document.getElementById('btn-test-play');
        if (btnPlay) btnPlay.textContent = '▶';
    }

    // =========================================================
    // LOG
    // =========================================================
    let logEntradas = [];
    let logDirty = false;
    let logTabActiva = false;

    function timestamp() {
        const now = new Date();
        const fecha = now.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const hora = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return `${fecha} ${hora}`;
    }

    function registrarLog(tipo, nodo, datos) {
        logEntradas.unshift({ tipo, nodo, datos, ts: timestamp() });
        if (logEntradas.length > 2000) logEntradas.length = 2000;
        logDirty = true;
    }

    function descargarArchivo(contenido, nombreArchivo, mimeType) {
        const blob = new Blob([contenido], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombreArchivo;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportarLog() {
        const lineas = [`OLT: ${oltActual} - LOG DE EVENTOS`, `Exportado: ${timestamp()}`, '─'.repeat(80)];
        logEntradas.forEach(e => {
            const b = `[${e.ts}] ${e.nodo}`;
            if (e.tipo === 'inicial')      lineas.push(`${b} | INICIO     | ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total} (${e.datos.zona} | ${e.datos.op})`);
            if (e.tipo === 'nueva_alarma') lineas.push(`${b} | ALARMA     | Antes:ON:${e.datos.onPrev||0} OFF:${e.datos.offPrev||0} (${e.datos.pDownPrev||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'empeora')      lineas.push(`${b} | EMPEORA    | Antes:ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'mejora')       lineas.push(`${b} | MEJORA     | Antes:ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) -> Ahora:ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%) | TOT: ${e.datos.total}`);
            if (e.tipo === 'recuperado')   lineas.push(`${b} | RECUPERA   | Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes}%) -> Ahora: ON:${e.datos.onActual} OFF:${e.datos.offActual} (${e.datos.pDownActual}%) | TOT: ${e.datos.total}`);
        });
        descargarArchivo(lineas.join('\n'), `log_${oltActual}_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    }

    function exportarCSV() {
        const ESTATUS = { inicial: 'INICIO', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', mejora: 'MEJORA', recuperado: 'RECUPERADO' };
        const esc = v => `"${String(v).replace(/"/g, '""')}"`;
        const enc = ['Fecha', 'Hora', 'OLT', 'Nodo', 'Ubicacion', 'Operadora', 'Estatus', 'ON Ant', 'OFF Ant', '% Ant', 'ON Act', 'OFF Act', '% Act', 'TOT'];
        const filas = logEntradas.map(e => {
            const [fecha = '', hora = ''] = e.ts.split(' ');
            let oA = '', oF = '', pA = '', nA = '', nF = '', pN = '', total = '';
            if (e.tipo === 'inicial') {
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
        descargarArchivo('\uFEFF' + [enc.join(','), ...filas].join('\n'), `log_${oltActual}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    }

    function renderizarLog() {
        const contenedor = document.getElementById('log-list');
        if (!contenedor) return;
        logDirty = false;

        if (logEntradas.length === 0) {
            contenedor.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin eventos registrados.</div>';
            return;
        }
        const colores = { inicial: '#555', nueva_alarma: '#ed5565', empeora: '#e67e22', mejora: '#f1c40f', recuperado: '#1ab394' };
        const iconos  = { inicial: '📋', nueva_alarma: '🔴', empeora: '📉', mejora: '📈', recuperado: '✅' };
        const labels  = { inicial: 'INICIO', nueva_alarma: 'ALARMA', empeora: 'EMPEORA', mejora: 'MEJORA', recuperado: 'RECUPERADO' };

        const entradasFiltradas = logBusqueda
            ? logEntradas.filter(e => e.nodo.toLowerCase().includes(logBusqueda) || (e.datos.zona || '').toLowerCase().includes(logBusqueda))
            : logEntradas;

        if (!entradasFiltradas.length) {
            contenedor.innerHTML = `<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin resultados para "<b>${escapeHtml(logBusqueda)}</b>"</div>`;
            return;
        }

        contenedor.innerHTML = entradasFiltradas.map(e => {
            let detalle = '';
            if (e.tipo === 'inicial') {
                detalle = `ON: <b>${e.datos.on}</b> | OFF: <b>${e.datos.off}</b> (${e.datos.pDown}%) | TOT: ${e.datos.total}`;
            } else if (e.tipo === 'nueva_alarma') {
                detalle = `Antes: ON:${e.datos.onPrev||0} OFF:${e.datos.offPrev||0} (${e.datos.pDownPrev||0}%) → <b>Ahora: ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%)</b>`;
            } else if (e.tipo === 'empeora' || e.tipo === 'mejora') {
                detalle = `Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes||0}%) → <b>Ahora: ON:${e.datos.on} OFF:${e.datos.off} (${e.datos.pDown}%)</b>`;
            } else if (e.tipo === 'recuperado') {
                detalle = `Antes: ON:${e.datos.onAntes} OFF:${e.datos.offAntes} (${e.datos.pDownAntes}%) → <b>Ahora: ON:${e.datos.onActual} OFF:${e.datos.offActual} (${e.datos.pDownActual}%)</b>`;
            }
            const zona = escapeHtml(e.datos.zona || '');
            const op   = escapeHtml(e.datos.op || '');
            const color = colores[e.tipo] || '#555';
            return `
                <div style="margin-bottom:7px;padding:7px 8px;border-left:4px solid ${color};background:rgba(255,255,255,0.04);border-radius:0 4px 4px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:${color};font-size:10px;font-weight:bold;">${iconos[e.tipo] || ''} ${labels[e.tipo] || escapeHtml(e.tipo)}</span>
                        <span style="color:#555;font-size:9px;">${escapeHtml(e.ts)}</span>
                    </div>
                    <div style="color:#ccc;font-size:12px;font-weight:bold;margin:2px 0;">${escapeHtml(e.nodo)}</div>
                    ${zona || op ? `<div style="color:#888;font-size:10px;">📍${zona} | 🏢${op}</div>` : ''}
                    <div style="color:#aaa;font-size:10px;">${detalle}</div>
                </div>`;
        }).join('');
    }

    // =========================================================
    // FAVICON Y TÍTULO
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
        if (
            ultimoEstadoPestana.oltName === oltName &&
            ultimoEstadoPestana.criticos === totalCriticos &&
            ultimoEstadoPestana.hayNuevos === hayNuevos
        ) {
            return;
        }
        ultimoEstadoPestana = { oltName, criticos: totalCriticos, hayNuevos };

        const labelOlt = oltName || 'OLT';
        document.title = totalCriticos > 0
            ? `${hayNuevos ? '🆕 ' : ''}(${totalCriticos}) ${labelOlt}`
            : `✅ ${labelOlt}`;

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
            faviconCtx.font = totalCriticos > 9 ? 'bold 14px sans-serif' : 'bold 18px sans-serif';
            faviconCtx.fillText(totalCriticos > 99 ? '99+' : String(totalCriticos), 16, 17);
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
    style.textContent = `
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
            font-family:'Google Sans', sans-serif; flex:1; text-align:center; transition:background 0.2s;
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
                    <span id="btn-flotante" title="Modo flotante">⧉</span>
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
            const content     = document.getElementById('alert-content');
            const btnToggle   = document.getElementById('toggle-btn');
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
        const inputUmbral = document.getElementById('umbral-valor');
        inputUmbral.value = umbralValor;
        document.getElementById('umbral-tipo').value = umbralTipo;

        const actualizarConfiguracion = () => {
            const val = parseFloat(inputUmbral.value);
            umbralValor = Number.isFinite(val) && val >= 1 ? val : 1;
            inputUmbral.value = umbralValor;
            umbralTipo = document.getElementById('umbral-tipo').value;
            localStorage.setItem('oltUmbralValor', umbralValor);
            localStorage.setItem('oltUmbralTipo', umbralTipo);

            oltSessionId++;
            oltAbortController.abort();
            oltAbortController = new AbortController();

            modoCargaInicial = true;
            registroNodos.clear();
            memoriaRedGlobal.clear();
            resultadosRCA.clear();
            logEntradas = [];
            logDirty = true;
            ultimoHTMLRenderizado = '';
            if (logTabActiva) renderizarLog();
            actualizarPestana(oltActual, 0, false);
            procesarNodos();
        };
        inputUmbral.addEventListener('change', actualizarConfiguracion);
        document.getElementById('umbral-tipo').addEventListener('change', actualizarConfiguracion);

        const selectAlarma = document.getElementById('selector-alarma');
        selectAlarma.value = alarmaGuardada in AUDIO_URLS ? alarmaGuardada : 'dosimeter';
        selectAlarma.addEventListener('change', function () {
            detenerSonido();
            sonidoAlerta = getAudio(this.value);
            localStorage.setItem('oltAlarmaSeleccionada', this.value);
            if ([...registroNodos.values()].some(d => !d.reconocido) && !silenciado && !muteGlobal) {
                sonidoAlerta.play().catch(() => {});
            }
        });

        document.getElementById('btn-test-play').onclick = () => {
            detenerSonido();
            enPrueba = true;
            sonidoAlerta.play().catch(() => {
                const statusEl = document.getElementById('mute-status');
                if (statusEl) {
                    const orig = statusEl.textContent;
                    statusEl.style.display = 'block';
                    statusEl.style.color = '#ed5565';
                    statusEl.textContent = '❌ Error al reproducir audio';
                    setTimeout(() => {
                        if (statusEl.textContent === '❌ Error al reproducir audio') {
                            statusEl.style.display = 'none';
                            statusEl.style.color = '';
                            statusEl.textContent = orig;
                        }
                    }, 3000);
                }
            });
            document.getElementById('btn-test-play').textContent = '🔊';
        };
        document.getElementById('btn-test-stop').onclick = () => {
            enPrueba = false;
            detenerSonido();
        };

        const selectOp = document.getElementById('filtro-op');
        selectOp.addEventListener('change', function () {
            filtroOp = this.value;
            localStorage.setItem('oltFiltroOp', filtroOp);
            procesarNodos();
        });
        selectOp.value = filtroOp;

        document.getElementById('btn-marcar-todos').onclick = () => {
            for (const data of registroNodos.values()) data.reconocido = true;
            enPrueba = false;
            detenerSonido();
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
                statusEl.style.display = 'block';
                statusEl.textContent = '🔒 Silencio permanente activo';
            } else if (silenciado && muteExpiraEn) {
                btnSil.classList.add('mute-temporal');
                statusEl.style.display = 'block';
                const mins = Math.max(1, Math.ceil((muteExpiraEn - Date.now()) / 60000));
                statusEl.textContent = `⏱ Silenciado ${mins}min restantes`;
            } else {
                btnSil.classList.add('mute-off');
                statusEl.style.display = 'none';
                statusEl.textContent = '';
            }
        }

        setInterval(aplicarMuteEstado, 30000);

        document.getElementById('btn-silenciar').addEventListener('click', () => {
            clicksRapidos++;
            clearTimeout(timerClickReset);
            timerClickReset = setTimeout(() => { clicksRapidos = 0; }, 10000);

            if (clicksRapidos >= 10) {
                clicksRapidos = 0;
                clearTimeout(timerMuteTemporal);
                muteExpiraEn = null;
                muteGlobal = !muteGlobal;
                silenciado = muteGlobal;
                localStorage.setItem('oltMuteGlobal', muteGlobal);
                enPrueba = false;
                detenerSonido();
                aplicarMuteEstado();
                return;
            }

            if (muteGlobal) {
                muteGlobal = false; silenciado = false; muteExpiraEn = null;
                localStorage.setItem('oltMuteGlobal', 'false');
                aplicarMuteEstado();
                return;
            }
            if (silenciado && muteExpiraEn) {
                clearTimeout(timerMuteTemporal);
                timerMuteTemporal = null;
                silenciado = false;
                muteExpiraEn = null;
                aplicarMuteEstado();
                return;
            }
            const DURACION_MS = 60 * 60 * 1000;
            muteExpiraEn = Date.now() + DURACION_MS;
            silenciado = true;
            enPrueba = false;
            detenerSonido();
            clearTimeout(timerMuteTemporal);
            timerMuteTemporal = setTimeout(() => {
                silenciado = false;
                muteExpiraEn = null;
                aplicarMuteEstado();
            }, DURACION_MS);
            aplicarMuteEstado();
        });

        if (muteGlobal) aplicarMuteEstado();

        document.getElementById('btn-exportar-log').onclick = exportarLog;
        document.getElementById('btn-exportar-csv').onclick = exportarCSV;

        // --- Tabs ---
        document.getElementById('tab-alarmas').onclick = () => {
            logTabActiva = false;
            document.getElementById('vista-alarmas').style.display = 'block';
            document.getElementById('vista-log').style.display = 'none';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-active';
            document.getElementById('tab-log').className     = 'tab-btn tab-inactive';
        };
        document.getElementById('tab-log').onclick = () => {
            logTabActiva = true;
            document.getElementById('vista-alarmas').style.display = 'none';
            document.getElementById('vista-log').style.display = 'block';
            document.getElementById('tab-alarmas').className = 'tab-btn tab-inactive';
            document.getElementById('tab-log').className     = 'tab-btn tab-active';
            if (logDirty) renderizarLog();
        };
        document.getElementById('log-busqueda').addEventListener('input', function () {
            logBusqueda = this.value.trim().toLowerCase();
            renderizarLog();
        });

        document.getElementById('panel-header').onclick = function (e) {
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

    function updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, stateKey, bgColor, blink) {
        if (!labelPrincipal) return;
        const fullKey = `${pDown}|${pUp}|${stateKey}`;
        if (labelPrincipal.dataset.nocState === fullKey) return;
        labelPrincipal.dataset.nocState = fullKey;

        labelPrincipal.innerHTML = `<div style="line-height:1.1;"><b style="font-size:11px;">${pDown}% DN</b><br><span style="font-size:9px;">${pUp}% UP</span></div>`;
        labelPrincipal.className = blink ? 'label celda-acs-blink' : 'label';
        labelPrincipal.style.cssText = blink
            ? 'display:inline-block!important;width:68px!important;color:white!important;border-radius:4px;text-align:center;'
            : `display:inline-block!important;width:68px!important;background-color:${bgColor}!important;color:white!important;border-radius:4px;text-align:center;border:1px solid rgba(255,255,255,0.05);`;

        const etiquetas = celdaPort.querySelectorAll('.gpon-util .label');
        for (let j = 1; j < etiquetas.length; j++) {
            if (!etiquetas[j].classList.contains('label-success') && etiquetas[j].style.display !== 'none') {
                etiquetas[j].style.display = 'none';
            }
        }
    }

    // =========================================================
    // LOOP PRINCIPAL
    // =========================================================
    function procesarNodos() {
        if (!window.location.href.includes('/monitoring/olt/')) return;
        crearPanel();

        const oltName = document.querySelector('.olt-monitoring-details-olt-title')?.innerText.trim() || '';
        if (oltName && oltName !== oltActual) {
            oltActual = oltName;
            oltSessionId++;
            oltAbortController.abort();
            oltAbortController = new AbortController();

            modoCargaInicial = true;
            logEntradas = [];
            logDirty = true;
            registroNodos.clear();
            memoriaRedGlobal.clear();
            resultadosRCA.clear();
            ultimoHTMLRenderizado = '';
            if (!enPrueba) detenerSonido();
        }

        const filas = document.querySelectorAll('tbody tr');
        let tablaCargada = false;
        for (const fila of filas) {
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
                document.title = `⏳ Cargando ${oltActual || 'OLT'}...`;
            }
            return;
        }

        const criticosActuales = [];
        let hayNovedadesParaAlarma = false;
        const matchOlt = window.location.pathname.match(/\/olt\/(\d+)/);
        const oltIdUrl = matchOlt ? matchOlt[1] : null;

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
                const on  = parseInt(celdaPort.querySelector('.label-green')?.innerText, 10)  || 0;
                const off = parseInt(celdaPort.querySelector('.label-danger')?.innerText, 10) || 0;
                const total = on + off;
                if (total === 0) continue;

                const downNum = (off / total) * 100;
                const pDown = downNum.toFixed(1);
                const pUp   = ((on / total) * 100).toFixed(1);
                const idNodo = `${oltName}${slotStr}${portStr}A`;
                const superaUmbral = umbralTipo === 'porcentaje' ? parseFloat(pDown) >= umbralValor : off >= umbralValor;

                const info      = DB_NODOS[idNodo] || { op: '---', zona: 'S/I' };
                const datosNodo = { total, on, off, pDown, pUp, zona: info.zona, op: info.op };
                const memPrevia = memoriaRedGlobal.get(idNodo);
                const comoInicial = modoCargaInicial || !memPrevia;

                const labelPrincipal = celdaPort.querySelector('.gpon-util .label');

                if (superaUmbral) {
                    const rcaState = resultadosRCA.get(idNodo);
                    const cambioConteo = rcaState && (rcaState.off !== off || rcaState.on !== on);
                    const errorExpirado = rcaState && rcaState.status === 'error' && (Date.now() - rcaState.ts) > 30000;
                    const debeConsultarRca =
                        !rcaState ||
                        (rcaState.status !== 'loading' && (cambioConteo || errorExpirado));

                    if (debeConsultarRca && oltIdUrl) {
                        ejecutarRCA(idNodo, oltIdUrl, parseInt(slotStr, 10), parseInt(portStr, 10), off, on);
                    }

                    const rcaActual = resultadosRCA.get(idNodo);
                    const rcaPendiente = !rcaActual || rcaActual.status === 'loading';
                    const rcaValido = rcaActual && rcaActual.status === 'done' && RCA_VALIDAS.has(rcaActual.dominante);
                    const rcaIgnorado = rcaActual && rcaActual.status === 'done' && !rcaValido;

                    if (!registroNodos.has(idNodo)) {
                        registroNodos.set(idNodo, {
                            origen:        comoInicial ? 'inicial' : 'nuevo',
                            reconocido:    comoInicial || rcaIgnorado,
                            notificado:    comoInicial,
                            timestamp:     Date.now(),
                            offAnterior:   off,
                            onAnterior:    on,
                            pDownAnterior: pDown,
                            totalAnterior: total
                        });

                        if (comoInicial) {
                            registrarLog('inicial', idNodo, datosNodo);
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

                    if (rcaValido && !data.notificado && data.origen === 'nuevo') {
                        data.notificado = true;
                        hayNovedadesParaAlarma = true;
                        const prev = memPrevia || {};
                        registrarLog('nueva_alarma', idNodo, { ...datosNodo, offPrev: prev.off, onPrev: prev.on, pDownPrev: prev.pDown });
                    }

                    if (rcaIgnorado) {
                        data.reconocido = true;
                    }

                    const esNuevoParaPanel = (data.origen === 'nuevo' && !data.reconocido && rcaValido);

                    if (rcaIgnorado) {
                        updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, 'ign', '#7f8c8d', false);
                    } else if (rcaPendiente) {
                        updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, 'pend', '#e67e22', false);
                    } else if (esNuevoParaPanel) {
                        updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, 'blink', '', true);
                    } else {
                        updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, 'crit', '#a93226', false);
                    }

                    const borderColor = rcaIgnorado ? '#7f8c8d' : (rcaPendiente ? '#e67e22' : '#a93226');
                    criticosActuales.push({ id: idNodo, down: pDown, downNum, off, total, ...info, esNuevoParaPanel, borderColor });
                } else {
                    resultadosRCA.delete(idNodo);
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
                    updateLabelCell(celdaPort, labelPrincipal, pDown, pUp, 'ok', '#1ab394', false);
                }

                memoriaRedGlobal.set(idNodo, { off, on, total, pDown });
            }
        });

        if (hayNovedadesParaAlarma && !silenciado && !muteGlobal) sonidoAlerta.play().catch(() => {});
        if (!enPrueba && criticosActuales.length === 0) detenerSonido();

        modoCargaInicial = false;

        if (logDirty && logTabActiva) {
            renderizarLog();
        }

        const selectOp = document.getElementById('filtro-op');
        if (selectOp) {
            const opsEnOlt = [...new Set(criticosActuales.map(c => c.op).filter(Boolean))];
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
                filtroOp = selectOp.value;
                localStorage.setItem('oltFiltroOp', filtroOp);
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
            const getPrio = (id) => {
                const dom = resultadosRCA.get(id)?.dominante;
                if (!dom) return 2;
                if (RCA_VALIDAS.has(dom)) return 1;
                if (dom === 'dying-gasp' || dom === 'power-off') return 3;
                if (dom === 'deactive' || dom === 'SUSPENDED') return 4;
                return 2;
            };

            const nuevoHTML = criticosFiltrados.length > 0
                ? criticosFiltrados
                    .sort((a, b) => {
                        if (a.esNuevoParaPanel !== b.esNuevoParaPanel) return a.esNuevoParaPanel ? -1 : 1;
                        const prioDiff = getPrio(a.id) - getPrio(b.id);
                        return prioDiff !== 0 ? prioDiff : b.downNum - a.downNum;
                    })
                    .map(c => `
                        <div class="${c.esNuevoParaPanel ? 'tarjeta-panel-blink' : ''}" style="margin-bottom:10px;padding:9px;border-left:5px solid ${c.esNuevoParaPanel ? '#ed5565' : c.borderColor};background:rgba(255,255,255,0.05);border-radius:0 5px 5px 0;">
                            <div style="display:flex;align-items:center;justify-content:space-between;">
                                <span style="color:#1ab394;font-weight:900;font-size:14px;letter-spacing:0.5px;">${escapeHtml(c.id)}</span>
                                ${c.esNuevoParaPanel ? '<span class="badge-nuevo">NUEVO</span>' : ''}
                            </div>
                            <div style="font-size:10px;color:#ddd;margin:3px 0;">📍 ${escapeHtml(c.zona)} | 🏢 ${escapeHtml(c.op)}</div>
                            <div style="margin-top:5px;color:#ed5565;font-size:11px;font-weight:bold;">
                                ⚠️ ${c.down}% caída | 🔴 OFF:${c.off} | 👥 ${c.total}
                            </div>
                            ${renderRcaHtml(resultadosRCA.get(c.id))}
                        </div>`).join('')
                : criticosActuales.length > 0
                    ? `<div style="color:#aaa;text-align:center;padding:20px;font-size:11px;">Sin alarmas para <b>${escapeHtml(filtroOp)}</b></div>`
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
    let workerUrlRevoked = false;
    worker.onmessage = () => {
        if (!workerUrlRevoked) {
            workerUrlRevoked = true;
            URL.revokeObjectURL(workerBlobUrl);
        }
        procesarNodos();
    };
})();

// ==UserScript==
// @name        Multi-Locate ONT
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/fttx/locate-ont*
// @grant       none
// @version     3.1
// @author      Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function () {
    'use strict';

    const FETCH_TIMEOUT_MS = 15000;
    const DELAY_BETWEEN_ONTS_MS = 1000;
    const RETRY_DELAY_MS = 2000;
    const UMBRAL_BYTES = 500 * 1024 * 1024; // 500 MB en bytes

    function getAuthToken() {
        try {
            const rawUser = localStorage.getItem('currentUser');
            if (rawUser) {
                const tokenId = JSON.parse(rawUser)?.token?.id;
                if (typeof tokenId === 'string' && tokenId.length > 0) return tokenId;
            }
        } catch {}

        const regexJWT = /(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/;
        for (const storage of [localStorage, sessionStorage]) {
            for (let i = 0; i < storage.length; i++) {
                const val = storage.getItem(storage.key(i));
                if (typeof val === 'string' && val.includes('eyJ')) {
                    const match = val.match(regexJWT);
                    if (match) return match[1];
                }
            }
        }
        return null;
    }

    function escapeCsvCell(value) {
        if (value === null || value === undefined) return '""';
        const str = String(value).replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim();
        return `"${str}"`;
    }

    async function fetchWithTimeout(url, headers, timeoutMs, externalSignal) {
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort(externalSignal?.reason);

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort(externalSignal.reason);
            } else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
        }

        const timer = setTimeout(() => {
            controller.abort(new DOMException('Timeout', 'TimeoutError'));
        }, timeoutMs);

        try {
            return await fetch(url, { headers, signal: controller.signal });
        } finally {
            clearTimeout(timer);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        }
    }

    function sleepAbortable(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    let intentosInyeccion = 0;

    function inyectarPanel() {
        if (document.getElementById('vm-custom-filter')) return;
        const mainRow = document.querySelector('input[formcontrolname="serialNumber"]')?.closest('.row');
        if (!mainRow) {
            if (intentosInyeccion++ < 30 && window.location.pathname.includes('/fttx/locate-ont')) {
                setTimeout(inyectarPanel, 1000);
            }
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'vm-custom-filter';
        panel.style.cssText = 'background:#f4f4f4; border:2px solid #1ab394; padding:15px; margin-bottom:15px; border-radius:5px;';
        panel.innerHTML = `
            <div style="display:flex; gap:15px; align-items:flex-start;">
                <div style="flex-grow: 1;">
                    <label style="font-weight:bold; font-size:14px;">Lista de Seriales para Reporte CSV:</label>
                    <textarea id="vm-seriales-input" class="form-control" style="height: 100px; font-family:monospace;" placeholder="Pega los seriales aquí..."></textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:25px;">
                    <button id="vm-btn-start" class="btn btn-primary" style="font-weight:bold; min-width:180px; background:#1ab394;">Generar CSV</button>
                </div>
            </div>
            <div id="vm-log" style="font-size:11px; color:#555; margin-top:5px;">Listo para procesar en segundo plano vía API (más rápido).</div>
        `;

        mainRow.parentNode.insertBefore(panel, mainRow);

        const btnStart = document.getElementById('vm-btn-start');
        const logEl = document.getElementById('vm-log');

        btnStart.addEventListener('click', async function () {
            const inputTxt = document.getElementById('vm-seriales-input').value;
            const seriales = inputTxt
                .split(/[\s,;]+/)
                .map(s => s.trim().toUpperCase())
                .filter(s => s.length > 0);

            if (seriales.length === 0) return alert('No hay seriales para buscar.');

            const token = getAuthToken();
            if (!token) {
                alert('No se pudo encontrar el token de acceso. Por favor, asegúrate de haber iniciado sesión.');
                return;
            }

            const runController = new AbortController();
            const signal = runController.signal;
            btnStart.disabled = true;

            const overlay = document.createElement('div');
            overlay.id = 'vm-overlay';
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
            overlay.innerHTML = `
                <h2 style="color:#1ab394;">Consultando API y Generando CSV...</h2>
                <p id="vm-p">Iniciando...</p>
                <div id="vm-progress" style="width:300px; background:#444; border-radius:4px; margin-top:10px; height:8px;">
                    <div id="vm-progress-bar" style="width:0%; height:8px; background:#1ab394; border-radius:4px; transition: width 0.3s;"></div>
                </div>
                <button id="vm-overlay-cancel" style="margin-top: 20px; padding: 8px 24px; background: #e74c3c; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold; cursor: pointer;">✖ Cancelar</button>
            `;
            document.body.appendChild(overlay);

            document.getElementById('vm-overlay-cancel').onclick = () => {
                runController.abort(new DOMException('Cancelled by user', 'AbortError'));
            };

            const baseUrl = window.location.origin;
            const headers = {
                'accept': 'application/json, text/plain, */*',
                'x-access-token': token
            };

            const hoy = new Date();
            const ayer = new Date(hoy);
            ayer.setDate(ayer.getDate() - 1);
            const formatFecha = (d) => {
                const mes = String(d.getMonth() + 1).padStart(2, '0');
                const dia = String(d.getDate()).padStart(2, '0');
                return `${d.getFullYear()}-${mes}-${dia}`;
            };
            const strHoy = formatFecha(hoy);
            const strAyer = formatFecha(ayer);

            const resultados = [];
            const serialCache = new Map();
            let authExpirada = false;

            const progressText = document.getElementById('vm-p');
            const progressBar = document.getElementById('vm-progress-bar');
            const locateFilter = encodeURIComponent(JSON.stringify({ include: {} }));
            const consFilter = encodeURIComponent(JSON.stringify({ order: 'consumptionDay ASC', include: {} }));

            try {
                for (let i = 0; i < seriales.length; i++) {
                    if (signal.aborted) break;

                    const s = seriales[i];
                    progressBar.style.width = `${((i + 1) / seriales.length) * 100}%`;

                    if (serialCache.has(s)) {
                        progressText.textContent = `Caché (${i + 1}/${seriales.length}): ${s}`;
                        resultados.push({ ...serialCache.get(s) });
                        continue;
                    }

                    let fila = { serial: s, status: 'ERROR/NO ENCONTRADO', consumo: 'N/A', cliente: '', olt: '', rx: '', tx: '' };
                    let ontEncontrada = false;

                    for (let intento = 1; intento <= 3; intento++) {
                        if (signal.aborted) break;

                        progressText.textContent = `Buscando (${i + 1}/${seriales.length}): ${s}${intento > 1 ? ` (Reintento ${intento}/3)` : ''}`;

                        try {
                            const locateRes = await fetchWithTimeout(
                                `${baseUrl}/api/fttx/locate-ont-by-serial-number/${encodeURIComponent(s)}?filter=${locateFilter}`,
                                headers,
                                FETCH_TIMEOUT_MS,
                                signal
                            );

                            if (locateRes.status === 401 || locateRes.status === 403) {
                                authExpirada = true;
                                break;
                            }

                            if (locateRes.status === 404) {
                                fila.status = 'NO ENCONTRADO';
                                ontEncontrada = true;
                                break;
                            }

                            if (!locateRes.ok) throw new Error(`ONT HTTP ${locateRes.status}`);

                            const ontData = await locateRes.json();
                            const status = ontData?.generalStatus || 'Desconocido';
                            const terminalNodeId = ontData?.dbTerminalNodeId;
                            const cliente = ontData?.dbClientName || '';
                            const olt = ontData?.requestedOlt || '';
                            const rx = ontData?.rx ?? '';
                            const tx = ontData?.tx ?? '';

                            let consumo = 'NO';
                            if (terminalNodeId) {
                                try {
                                    const consRes = await fetchWithTimeout(
                                        `${baseUrl}/api/fttx/terminal-nodes/${encodeURIComponent(terminalNodeId)}/consumption?filter=${consFilter}`,
                                        headers,
                                        FETCH_TIMEOUT_MS,
                                        signal
                                    );

                                    if (consRes.status === 401 || consRes.status === 403) {
                                        authExpirada = true;
                                        break;
                                    }

                                    if (consRes.status === 404) {
                                        consumo = 'SIN DATOS';
                                    } else if (!consRes.ok) {
                                        consumo = 'ERROR';
                                    } else {
                                        const consData = await consRes.json();
                                        if (Array.isArray(consData)) {
                                            const totalBytesRecientes = consData
                                                .filter(c => {
                                                    const dia = String(c?.consumptionDay || '').slice(0, 10);
                                                    return dia === strHoy || dia === strAyer;
                                                })
                                                .reduce((acc, curr) => {
                                                    const down = parseInt(curr?.down || 0, 10) || 0;
                                                    const up = parseInt(curr?.up || 0, 10) || 0;
                                                    return acc + down + up;
                                                }, 0);

                                            if (totalBytesRecientes >= UMBRAL_BYTES) consumo = 'SI';
                                        }
                                    }
                                } catch (consErr) {
                                    if (signal.aborted) throw consErr;
                                    console.warn(`Falla consultando consumo para ${s}:`, consErr);
                                    consumo = 'ERROR';
                                }
                            }

                            fila = { serial: s, status, consumo, cliente, olt, rx, tx };
                            ontEncontrada = true;
                            break;
                        } catch (e) {
                            if (signal.aborted) break;
                            console.warn(`Intento ${intento} fallido para ${s}:`, e);
                            if (intento < 3) {
                                try {
                                    await sleepAbortable(RETRY_DELAY_MS, signal);
                                } catch {
                                    break;
                                }
                            }
                        }
                    }

                    if (authExpirada || signal.aborted) break;

                    if (ontEncontrada || fila.status === 'ERROR/NO ENCONTRADO') {
                        serialCache.set(s, fila);
                        resultados.push(fila);
                    }

                    if (i < seriales.length - 1) {
                        try {
                            await sleepAbortable(DELAY_BETWEEN_ONTS_MS, signal);
                        } catch {
                            break;
                        }
                    }
                }
            } finally {
                overlay.remove();
                btnStart.disabled = false;
            }

            if (authExpirada) {
                alert('Tu sesión ha expirado (HTTP 401/403). Recarga la página e inicia sesión nuevamente.');
            }

            if (resultados.length > 0) {
                const lines = ['Serial,Status,Consumo,Cliente,OLT,RX,TX'];
                for (const row of resultados) {
                    lines.push([
                        escapeCsvCell(row.serial),
                        escapeCsvCell(row.status),
                        escapeCsvCell(row.consumo),
                        escapeCsvCell(row.cliente),
                        escapeCsvCell(row.olt),
                        escapeCsvCell(row.rx),
                        escapeCsvCell(row.tx)
                    ].join(','));
                }

                const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `Reporte_ONTs_${Date.now()}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }

            if (logEl) {
                const estadoFinal = authExpirada
                    ? 'Detenido por sesión expirada.'
                    : signal.aborted
                        ? `Cancelado por el usuario (${resultados.length}/${seriales.length} exportados).`
                        : `Completado: ${resultados.length}/${seriales.length} seriales procesados.`;
                logEl.textContent = estadoFinal;
            }
        });
    }

    setTimeout(inyectarPanel, 1500);
})();

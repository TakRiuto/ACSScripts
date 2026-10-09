// ==UserScript==
// @name         InCa ACS - NOC Slot Outage Monitor
// @version      3.0
// @description  Monitoreo en tiempo real de caídas a cero (online=0) con diseño NOC e invalidación reactiva de caché.
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/BoardDetector.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/BoardDetector.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// @match        https://190.153.58.82/monitoring/olt/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Estado global reactivo
    let currentOltId = null;
    let lastTelemetryTimestamp = null;
    const slotCache = new Map();
    const pendingSlots = new Set();

    // Inyección de estilos con tokens exactos del NOC Design System
    const styles = `
        :root {
            --accent: #00f0ff;
            --accent-rgb: 0, 240, 255;
            --bg-base: #0a0f14;
            --bg-surface: #0d1117;
            --bg-surface-hover: #161b22;
            --bg-border: #21262d;
            --bg-border-strong: #30363d;

            --bg-error-muted: #240a0a;
            --border-error-muted: #4d0000;
            --text-error-muted: #ff0055;
            --status-error: #ff0055;

            --bg-success-muted: #0d1a14;
            --border-success-muted: #004d26;
            --status-success: #00ff66;

            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --text-muted: #484f58;

            --font-main: "IBM Plex Sans", -apple-system, sans-serif;
            --font-mono: "IBM Plex Mono", "Cascadia Code", monospace;
            --radius-base: 0px;
        }

        /* Badge minimalista brutalista */
        .noc-slot-badge {
            font-family: var(--font-mono);
            font-size: 11px;
            font-weight: 700;
            line-height: 1;
            padding: 3px 6px;
            border-radius: var(--radius-base);
            display: inline-block;
            margin-left: 6px;
            vertical-align: middle;
            user-select: none;
            box-sizing: border-box;
            border: 1px solid transparent;
        }

        .noc-badge-ok {
            background: var(--bg-success-muted);
            border-color: var(--border-success-muted);
            color: var(--status-success);
            opacity: 0.85;
        }

        .noc-badge-alert {
            background: var(--bg-error-muted);
            border-color: var(--border-error-muted);
            color: var(--status-error);
            cursor: pointer;
        }

        .noc-badge-alert:hover {
            border-color: var(--status-error);
            filter: brightness(1.2);
        }

        /* Modal Overlay NOC */
        .noc-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(3px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .noc-modal-box {
            background: var(--bg-surface);
            border: 1px solid var(--bg-border-strong);
            border-radius: var(--radius-base);
            width: 580px;
            max-width: 95vw;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            color: var(--text-primary);
            font-family: var(--font-main);
        }

        .noc-modal-header {
            padding: 12px 16px;
            background: var(--bg-base);
            border-bottom: 1px solid var(--bg-border-strong);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .noc-modal-title {
            margin: 0;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: var(--accent);
            font-family: var(--font-mono);
            text-transform: uppercase;
        }

        .noc-modal-close {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 18px;
            cursor: pointer;
            line-height: 1;
            padding: 0;
        }

        .noc-modal-close:hover {
            color: var(--status-error);
        }

        .noc-modal-body {
            padding: 16px;
            overflow-y: auto;
        }

        /* Tabla estilo .v-table */
        .noc-v-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 11px;
            font-family: var(--font-mono);
            text-align: left;
        }

        .noc-v-table th {
            padding: 8px 12px;
            background: #05080a;
            color: var(--text-secondary);
            font-weight: 700;
            border-bottom: 1px solid var(--bg-border-strong);
            text-transform: uppercase;
        }

        .noc-v-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--bg-border);
            background: rgba(0,0,0,0.15);
        }

        .noc-v-table tr:hover td {
            background: var(--bg-surface-hover);
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.innerHTML = styles;
    document.head.appendChild(styleEl);

    // Helpers
    function getToken() {
        try {
            const rawUser = localStorage.getItem('currentUser');
            if (!rawUser) return null;
            return JSON.parse(rawUser)?.token?.id || null;
        } catch {
            return null;
        }
    }

    function getOltIdFromUrl() {
        const match = window.location.pathname.match(/\/monitoring\/olt\/(\d+)/);
        return match ? match[1] : null;
    }

    // Modal de Historial
    function showModal(slotId, events) {
        const existing = document.getElementById('noc-modal-overlay-root');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'noc-modal-overlay-root';
        overlay.className = 'noc-modal-overlay';

        const rows = events.map((ev, i) => {
            const start = new Date(ev.start).toLocaleString('es-VE', { hour12: false });
            const end = ev.end ? new Date(ev.end).toLocaleString('es-VE', { hour12: false }) : 'EN CURSO';
            return `
                <tr>
                    <td style="color: var(--text-secondary);">#${i + 1}</td>
                    <td style="color: var(--status-error);">${start}</td>
                    <td style="color: ${ev.end ? 'var(--status-success)' : 'var(--status-error)'};">${end}</td>
                    <td style="color: var(--accent);">${ev.duration}</td>
                </tr>
            `;
        }).join('');

        overlay.innerHTML = `
            <div class="noc-modal-box">
                <div class="noc-modal-header">
                    <span class="noc-modal-title">HISTORIAL CAÍDAS [ONLINE = 0] :: SLOT ${slotId}</span>
                    <button class="noc-modal-close" id="btn-close-noc-modal">&#x2715;</button>
                </div>
                <div class="noc-modal-body">
                    <table class="noc-v-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Inicio Caída</th>
                                <th>Restablecido</th>
                                <th>Duración</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        document.getElementById('btn-close-noc-modal').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        const escListener = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escListener);
            }
        };
        document.addEventListener('keydown', escListener);
    }

    // Procesar caídas (1 evento consecutivo hasta que levanta)
    function parseOutageEvents(data) {
        data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const events = [];
        let inOutage = false;
        let outageStart = null;

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (item.online === 0) {
                if (!inOutage) {
                    inOutage = true;
                    outageStart = item.createdAt;
                }
            } else {
                if (inOutage) {
                    inOutage = false;
                    const diffMin = Math.round((new Date(item.createdAt) - new Date(outageStart)) / 60000);
                    events.push({
                        start: outageStart,
                        end: item.createdAt,
                        duration: `${diffMin}m`
                    });
                    outageStart = null;
                }
            }
        }

        if (inOutage && outageStart) {
            events.push({
                start: outageStart,
                end: null,
                duration: 'ACTIVO'
            });
        }

        return events;
    }

    // Actualiza o inserta el badge numérico sin parpadeos
    function updateBadge(targetCell, slotId, events) {
        const innerP = targetCell.querySelector('p.datatable-body-cell-label-inner');
        if (!innerP) return;

        let badge = innerP.querySelector('.noc-slot-badge');
        if (!badge) {
            badge = document.createElement('span');
            innerP.appendChild(badge);
        }

        const count = events.length;
        badge.className = `noc-slot-badge ${count > 0 ? 'noc-badge-alert' : 'noc-badge-ok'}`;
        badge.textContent = count;
        badge.title = count > 0
            ? `Slot ${slotId}: ${count} caída(s) a 0. Click para ver historial.`
            : `Slot ${slotId}: Sin caídas a cero`;

        if (count > 0) {
            badge.onclick = (e) => {
                e.stopPropagation();
                showModal(slotId, events);
            };
        } else {
            badge.onclick = null;
        }
    }

    // Consulta de la API para un Slot específico
    async function loadSlotData(oltId, slotId, token, targetCell) {
        if (slotCache.has(slotId)) {
            updateBadge(targetCell, slotId, slotCache.get(slotId));
            return;
        }

        if (pendingSlots.has(slotId)) return;
        pendingSlots.add(slotId);

        try {
            const url = `https://190.153.58.82/api/fttx/monitoring/olt-usage/${oltId}/statuses/slots/${slotId}?filter=%7B%22order%22:%22createdAt%20ASC%22,%22include%22:%7B%7D%7D`;
            const resp = await fetch(url, {
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'x-access-token': token
                }
            });

            if (!resp.ok) return;

            const data = await resp.json();
            if (Array.isArray(data)) {
                const events = parseOutageEvents(data);
                slotCache.set(slotId, events);
                updateBadge(targetCell, slotId, events);
            }
        } catch (e) {
            console.error('[NOC Monitor] Error slot', slotId, e);
        } finally {
            pendingSlots.delete(slotId);
        }
    }

    // Verificación principal del estado de la página
    function processTable() {
        const oltId = getOltIdFromUrl();
        const token = getToken();
        if (!oltId || !token) return;

        // 1. Detección de cambio de OLT por URL
        if (currentOltId !== oltId) {
            currentOltId = oltId;
            lastTelemetryTimestamp = null;
            slotCache.clear();
            document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
        }

        // 2. Detección de actualización por fecha de telemetría (mismo OLT)
        const timestampEl = document.querySelector('.blockpanel-title span.label-primary.pull-right');
        if (timestampEl) {
            const currentTs = timestampEl.textContent.trim();
            if (lastTelemetryTimestamp && lastTelemetryTimestamp !== currentTs) {
                // Se actualizó la data de la OLT: limpiamos caché para re-consultar
                slotCache.clear();
                document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
            }
            lastTelemetryTimestamp = currentTs;
        }

        // 3. Procesar filas de la tabla
        const table = document.querySelector('table.olt-usage-details-datatable');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const firstCell = row.querySelector('td:first-child');
            const totalCell = row.querySelector('td:last-child');
            if (!firstCell || !totalCell) return;

            const slotText = firstCell.querySelector('.datatable-body-cell-label-inner')?.textContent?.trim()
                          || firstCell.textContent.trim();
            const slotId = parseInt(slotText, 10);

            if (!isNaN(slotId)) {
                loadSlotData(oltId, slotId, token, totalCell);
            }
        });
    }

    // Escucha de navegación SPA (Angular Routing)
    const handleUrlChange = () => {
        setTimeout(processTable, 200);
    };

    window.addEventListener('popstate', handleUrlChange);
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
        handleUrlChange();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        handleUrlChange();
    };

    // Observer reactivo para cambios dinámicos en el DOM
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processTable, 250);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Arranque inicial
    setTimeout(processTable, 800);
})();

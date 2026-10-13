// ==UserScript==
// @name         InCa ACS - NOC Slot Outage Monitor
// @namespace    Violentmonkey Scripts
// @version      4.3
// @description  Monitoreo de caídas a cero (online=0) bajo demanda con reintento automático, progreso y copia al portapapeles.
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/BoardDetector.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/BoardDetector.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// @match        https://190.153.58.82/monitoring/olt/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let currentOltId = null;
    let lastTelemetryTimestamp = null;
    const slotCache = new Map();
    let isFetching = false;
    let currentResults = [];

    // Estilos UI (Gris Grafito + Google Sans)
    const styles = `
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap');

        :root {
            --noc-font: 'Google Sans', 'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            --noc-bg-canvas: #161a1f;
            --noc-bg-panel: #1f242c;
            --noc-bg-card: #272d36;
            --noc-bg-card-hover: #2e3540;
            --noc-border-subtle: #333b47;
            --noc-border-strong: #444e5e;

            --noc-text-main: #e6ebf2;
            --noc-text-muted: #9aa5b5;
            --noc-text-dim: #6c7684;

            --noc-red-bg: #3a1d22;
            --noc-red-border: #732a33;
            --noc-red-text: #ff6b7a;

            --noc-green-bg: #193324;
            --noc-green-border: #255237;
            --noc-green-text: #4cd984;

            --noc-blue-accent: #3d8bfd;
            --noc-blue-hover: #2b77e5;
        }

        /* Botón de la barra de la OLT */
        .btn-audit-trigger {
            background-color: var(--noc-bg-card);
            color: var(--noc-text-main);
            border: 1px solid var(--noc-border-subtle);
            font-family: var(--noc-font);
            font-size: 11px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 12px;
            vertical-align: middle;
            transition: all 0.15s ease;
        }
        .btn-audit-trigger:hover {
            background-color: var(--noc-bg-card-hover);
            border-color: var(--noc-blue-accent);
            color: #fff;
        }

        /* Badges de la tabla */
        .noc-slot-badge {
            font-family: var(--noc-font);
            font-size: 11px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 3px;
            display: inline-block;
            margin-left: 6px;
            vertical-align: middle;
            user-select: none;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .noc-badge-ok {
            background: var(--noc-green-bg);
            border-color: var(--noc-green-border);
            color: var(--noc-green-text);
        }
        .noc-badge-alert {
            background: var(--noc-red-bg);
            border-color: var(--noc-red-border);
            color: var(--noc-red-text);
        }

        /* Menú lateral flotante (Drawer) */
        .noc-drawer-overlay {
            position: fixed;
            inset: 0;
            background: rgba(10, 13, 17, 0.65);
            backdrop-filter: blur(2px);
            z-index: 999999;
            display: flex;
            justify-content: flex-end;
            animation: fadeIn 0.15s ease-out;
        }

        .noc-drawer {
            width: 530px;
            max-width: 92vw;
            height: 100vh;
            background: var(--noc-bg-panel);
            border-left: 1px solid var(--noc-border-subtle);
            box-shadow: -8px 0 30px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            font-family: var(--noc-font);
            color: var(--noc-text-main);
            animation: slideIn 0.2s ease-out;
        }

        @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .noc-drawer-header {
            padding: 16px 20px;
            background: var(--noc-bg-canvas);
            border-bottom: 1px solid var(--noc-border-subtle);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .noc-drawer-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--noc-text-main);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .noc-drawer-close {
            background: none;
            border: none;
            color: var(--noc-text-muted);
            font-size: 20px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
        }
        .noc-drawer-close:hover { color: #fff; }

        /* Toolbar del Drawer */
        .noc-drawer-toolbar {
            padding: 12px 20px;
            background: var(--noc-bg-canvas);
            border-bottom: 1px solid var(--noc-border-subtle);
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .btn-modal-action {
            background-color: var(--noc-blue-accent);
            color: #fff;
            border: none;
            padding: 8px 14px;
            font-family: var(--noc-font);
            font-size: 12px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: background-color 0.15s ease;
        }
        .btn-modal-action:hover { background-color: var(--noc-blue-hover); }
        .btn-modal-action:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-modal-copy {
            background-color: var(--noc-bg-card);
            color: var(--noc-text-main);
            border: 1px solid var(--noc-border-subtle);
            padding: 8px 14px;
            font-family: var(--noc-font);
            font-size: 12px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
        }
        .btn-modal-copy:hover:not(:disabled) {
            background-color: var(--noc-bg-card-hover);
            border-color: var(--noc-green-text);
            color: var(--noc-green-text);
        }
        .btn-modal-copy:disabled { opacity: 0.4; cursor: not-allowed; }

        .noc-drawer-body {
            flex: 1;
            padding: 16px 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* Barra de Progreso */
        .noc-progress-container {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 10px 14px;
            background: var(--noc-bg-card);
            border: 1px solid var(--noc-border-subtle);
            border-radius: 6px;
        }
        .noc-progress-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--noc-text-muted);
        }
        .noc-progress-track {
            width: 100%;
            height: 6px;
            background: var(--noc-bg-canvas);
            border-radius: 3px;
            overflow: hidden;
        }
        .noc-progress-fill {
            height: 100%;
            background: var(--noc-blue-accent);
            width: 0%;
            transition: width 0.2s ease;
        }

        /* Tarjeta de Slot */
        .noc-slot-card {
            background: var(--noc-bg-card);
            border: 1px solid var(--noc-border-subtle);
            border-radius: 6px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .noc-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .noc-card-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--noc-text-main);
        }

        .noc-events-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 4px;
        }
        .noc-event-row {
            background: var(--noc-bg-panel);
            border: 1px solid var(--noc-border-subtle);
            border-radius: 4px;
            padding: 7px 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
        }
        .noc-event-dates {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .noc-event-badge-dur {
            background: var(--noc-bg-canvas);
            color: var(--noc-text-muted);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            border: 1px solid var(--noc-border-subtle);
        }

        .noc-summary-bar {
            padding: 10px 14px;
            background: var(--noc-bg-canvas);
            border: 1px solid var(--noc-border-subtle);
            border-radius: 6px;
            font-size: 12px;
            display: flex;
            justify-content: space-around;
            color: var(--noc-text-muted);
        }
        .noc-summary-bar strong { color: var(--noc-text-main); }

        .noc-empty-placeholder {
            text-align: center;
            color: var(--noc-text-muted);
            padding: 50px 20px;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }
        .noc-empty-placeholder i {
            font-size: 28px;
            color: var(--noc-text-dim);
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

    function getOltName() {
        const titleEl = document.querySelector('.olt-monitoring-details-olt-title');
        return titleEl?.textContent?.trim() || `OLT-${getOltIdFromUrl() || 'Unknown'}`;
    }

    function isNaValue(val) {
        if (val === null || val === undefined) return true;
        if (typeof val === 'string') {
            const clean = val.trim().toUpperCase();
            if (clean === 'N/A' || clean === 'NA' || clean === '') return true;
        }
        return false;
    }

    // Regla de análisis de caídas (N/A no es 0)
    function parseOutageEvents(data) {
        data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const events = [];
        let inOutage = false;
        let outageStart = null;

        for (let i = 0; i < data.length; i++) {
            const item = data[i];

            if (isNaValue(item.online)) continue;

            const online = Number(item.online);
            const offline = Number(item.offline) || 0;
            const suspended = Number(item.suspended) || 0;
            const totalOnus = online + offline + suspended;

            // Descartar si el slot está desocupado o es inválido
            if (isNaN(online) || totalOnus === 0) continue;

            if (online === 0) {
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
                        duration: `${diffMin} min`
                    });
                    outageStart = null;
                }
            }
        }

        if (inOutage && outageStart) {
            events.push({
                start: outageStart,
                end: null,
                duration: 'En curso'
            });
        }

        return events;
    }

    // Consulta de datos de un Slot con REINTENTO AUTOMÁTICO (hasta 3 intentos)
    async function fetchSlotWithRetry(oltId, slotId, token, maxRetries = 3) {
        if (slotCache.has(slotId)) return slotCache.get(slotId);

        const url = `https://190.153.58.82/api/fttx/monitoring/olt-usage/${oltId}/statuses/slots/${slotId}?filter=%7B%22order%22:%22createdAt%20ASC%22,%22include%22:%7B%7D%7D`;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const resp = await fetch(url, {
                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'x-access-token': token
                    }
                });

                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

                const data = await resp.json();
                if (Array.isArray(data)) {
                    const events = parseOutageEvents(data);
                    slotCache.set(slotId, events);
                    return events;
                }
                throw new Error('Respuesta no válida');
            } catch (e) {
                console.warn(`[NOC Monitor] Slot ${slotId} intento ${attempt}/${maxRetries} falló:`, e.message);
                if (attempt === maxRetries) {
                    console.error(`[NOC Monitor] Slot ${slotId} descartado tras ${maxRetries} intentos.`);
                    return [];
                }
                await new Promise(res => setTimeout(res, attempt * 500));
            }
        }
        return [];
    }

    // Render de tarjetas dentro del Drawer
    function renderCardsInsideDrawer(results) {
        const bodyEl = document.getElementById('noc-drawer-body-container');
        if (!bodyEl) return;

        let totalEventsCount = 0;
        let slotsWithOutages = 0;

        const cardsHtml = results.map(item => {
            const count = item.events.length;
            totalEventsCount += count;
            if (count > 0) slotsWithOutages++;

            const statusBadge = count > 0
                ? `<span class="noc-slot-badge noc-badge-alert">${count} caída(s)</span>`
                : `<span class="noc-slot-badge noc-badge-ok">Estable</span>`;

            const eventsList = count > 0
                ? `<div class="noc-events-list">
                    ${item.events.map(ev => `
                        <div class="noc-event-row">
                            <div class="noc-event-dates">
                                <span style="color: var(--noc-red-text);">Caída: ${new Date(ev.start).toLocaleString('es-VE')}</span>
                                <span style="color: ${ev.end ? 'var(--noc-green-text)' : 'var(--noc-red-text)'};">
                                    ${ev.end ? `Recuperado: ${new Date(ev.end).toLocaleString('es-VE')}` : 'Estado: Actualmente Caído'}
                                </span>
                            </div>
                            <span class="noc-event-badge-dur">${ev.duration}</span>
                        </div>
                    `).join('')}
                   </div>`
                : `<div style="font-size: 11px; color: var(--noc-text-dim);">Sin interrupciones a online = 0</div>`;

            return `
                <div class="noc-slot-card">
                    <div class="noc-card-header">
                        <span class="noc-card-title">Tarjeta / Slot ${item.slotId}</span>
                        ${statusBadge}
                    </div>
                    ${eventsList}
                </div>
            `;
        }).join('');

        bodyEl.innerHTML = `
            <div class="noc-summary-bar">
                <span>Slots analizados: <strong>${results.length}</strong></span>
                <span>Con incidencias: <strong style="color: var(--noc-red-text);">${slotsWithOutages}</strong></span>
                <span>Total Caídas: <strong style="color: var(--noc-red-text);">${totalEventsCount}</strong></span>
            </div>
            ${cardsHtml}
        `;
    }

    // Generar texto estructurado y copiar al portapapeles
    async function copyReportToClipboard() {
        if (!currentResults || currentResults.length === 0) return;

        const btnCopy = document.getElementById('btn-modal-copy-report');
        const oltName = getOltName();
        const oltId = getOltIdFromUrl();
        const now = new Date().toLocaleString('es-VE');

        let totalEvents = 0;
        const affectedSlots = [];
        const cleanSlots = [];

        currentResults.forEach(item => {
            if (item.events.length > 0) {
                totalEvents += item.events.length;
                affectedSlots.push(item);
            } else {
                cleanSlots.push(item.slotId);
            }
        });

        let txt = `=================================================================\n`;
        txt += `   REPORTE DE INCIDENCIAS DE TARJETAS (ONLINE = 0) - NOC\n`;
        txt += `=================================================================\n`;
        txt += `OLT:               ${oltName} (ID: ${oltId})\n`;
        txt += `Fecha Generación:  ${now}\n`;
        txt += `Slots Analizados:  ${currentResults.length}\n`;
        txt += `Slots Afectados:   ${affectedSlots.length}\n`;
        txt += `Total Caídas:      ${totalEvents}\n`;
        txt += `=================================================================\n\n`;

        if (affectedSlots.length > 0) {
            txt += `[ DETALLE DE TARJETAS CON CAÍDAS ]\n`;
            txt += `-----------------------------------------------------------------\n`;
            affectedSlots.forEach(item => {
                txt += `\n* SLOT ${item.slotId} :: [${item.events.length} Evento(s)]\n`;
                item.events.forEach((ev, idx) => {
                    const start = new Date(ev.start).toLocaleString('es-VE');
                    const end = ev.end ? new Date(ev.end).toLocaleString('es-VE') : 'En curso';
                    txt += `  [#${idx + 1}] Caída: ${start} | Restablecido: ${end} | Duración: ${ev.duration}\n`;
                });
            });
            txt += `\n-----------------------------------------------------------------\n`;
        } else {
            txt += `[+] No se registraron caídas a cero en ningún slot de esta OLT.\n\n`;
        }

        if (cleanSlots.length > 0) {
            txt += `\n[ SLOTS ESTABLES / SIN CAÍDAS ]\n`;
            txt += `Slots: ${cleanSlots.join(', ')}\n`;
        }

        txt += `\n=================================================================\n`;
        txt += `Generado automáticamente por InCa ACS BoardDetector\n`;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(txt);
            } else {
                // Fallback para navegadores antiguos
                const ta = document.createElement('textarea');
                ta.value = txt;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }

            if (btnCopy) {
                const originalHtml = btnCopy.innerHTML;
                btnCopy.innerHTML = `<i class="fa fa-check" style="color: var(--noc-green-text);"></i> ¡Copiado!`;
                btnCopy.style.borderColor = 'var(--noc-green-text)';
                setTimeout(() => {
                    btnCopy.innerHTML = originalHtml;
                    btnCopy.style.borderColor = 'var(--noc-border-subtle)';
                }, 2200);
            }
        } catch (err) {
            console.error('[NOC Monitor] Error copiando al portapapeles:', err);
            alert('Error al copiar al portapapeles.');
        }
    }

    // Ejecutar consulta con Contador de Progreso
    async function executeQueryFromModal() {
        if (isFetching) return;
        const oltId = getOltIdFromUrl();
        const token = getToken();
        if (!oltId || !token) return;

        const table = document.querySelector('table.olt-usage-details-datatable');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        const validSlots = [];

        rows.forEach(row => {
            const firstCell = row.querySelector('td:first-child');
            const totalCell = row.querySelector('td:last-child');
            if (!firstCell || !totalCell) return;

            if (totalCell.textContent.trim().toUpperCase().includes('N/A')) return;

            const slotText = firstCell.querySelector('.datatable-body-cell-label-inner')?.textContent?.trim()
                          || firstCell.textContent.trim();
            const slotId = parseInt(slotText, 10);
            if (!isNaN(slotId)) validSlots.push(slotId);
        });

        const btnQuery = document.getElementById('btn-modal-query-action');
        const btnCopy = document.getElementById('btn-modal-copy-report');
        const bodyEl = document.getElementById('noc-drawer-body-container');

        if (btnQuery) btnQuery.disabled = true;
        if (btnCopy) btnCopy.disabled = true;

        isFetching = true;

        bodyEl.innerHTML = `
            <div class="noc-progress-container">
                <div class="noc-progress-header">
                    <span id="noc-progress-label">Iniciando consulta de slots...</span>
                    <span id="noc-progress-pct">0%</span>
                </div>
                <div class="noc-progress-track">
                    <div class="noc-progress-fill" id="noc-progress-fill-bar"></div>
                </div>
            </div>
            <div class="noc-empty-placeholder" style="padding: 30px;">
                <i class="fa fa-spinner fa-spin" style="color: var(--noc-blue-accent);"></i>
                <span>Analizando tarjetas...</span>
            </div>
        `;

        const total = validSlots.length;
        let completed = 0;
        const results = [];

        try {
            for (const slotId of validSlots) {
                const events = await fetchSlotWithRetry(oltId, slotId, token);
                results.push({ slotId, events });
                completed++;

                const pct = Math.round((completed / total) * 100);
                const progressLabel = document.getElementById('noc-progress-label');
                const progressPct = document.getElementById('noc-progress-pct');
                const progressBar = document.getElementById('noc-progress-fill-bar');

                if (progressLabel) progressLabel.textContent = `Procesando: Slot ${slotId} (${completed} / ${total})`;
                if (progressPct) progressPct.textContent = `${pct}%`;
                if (progressBar) progressBar.style.width = `${pct}%`;
            }

            results.sort((a, b) => b.events.length - a.events.length);
            currentResults = results;

            renderCardsInsideDrawer(results);
            syncTableBadges();

            if (btnCopy) btnCopy.disabled = false;
        } finally {
            isFetching = false;
            if (btnQuery) {
                btnQuery.disabled = false;
                btnQuery.innerHTML = `<i class="fa fa-refresh"></i> Actualizar Consulta`;
            }
        }
    }

    // Abrir menú lateral flotante de inmediato
    function openDrawerImmediate() {
        const existing = document.getElementById('noc-drawer-overlay-root');
        if (existing) {
            existing.style.display = 'flex';
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'noc-drawer-overlay-root';
        overlay.className = 'noc-drawer-overlay';

        overlay.innerHTML = `
            <div class="noc-drawer">
                <div class="noc-drawer-header">
                    <div class="noc-drawer-title">
                        <i class="fa fa-server" style="color: var(--noc-blue-accent);"></i>
                        Auditoría de Caídas (Online = 0)
                    </div>
                    <button class="noc-drawer-close" id="btn-close-noc-drawer">&times;</button>
                </div>
                <div class="noc-drawer-toolbar">
                    <button class="btn-modal-action" id="btn-modal-query-action">
                        <i class="fa fa-search"></i> Consultar Caídas
                    </button>
                    <button class="btn-modal-copy" id="btn-modal-copy-report" disabled title="Disponible tras consultar">
                        <i class="fa fa-clipboard"></i> Copiar Reporte
                    </button>
                </div>
                <div class="noc-drawer-body" id="noc-drawer-body-container">
                    <div class="noc-empty-placeholder">
                        <i class="fa fa-line-chart"></i>
                        <span>Presiona <strong>"Consultar Caídas"</strong> para iniciar el análisis con reintento automático.</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Eventos
        document.getElementById('btn-modal-query-action').onclick = executeQueryFromModal;
        document.getElementById('btn-modal-copy-report').onclick = copyReportToClipboard;

        const close = () => overlay.remove();
        document.getElementById('btn-close-noc-drawer').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        const escListener = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escListener);
            }
        };
        document.addEventListener('keydown', escListener);
    }

    // Sincronizar badges pequeños en la tabla de slots
    function syncTableBadges() {
        const table = document.querySelector('table.olt-usage-details-datatable');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const firstCell = row.querySelector('td:first-child');
            const totalCell = row.querySelector('td:last-child');
            if (!firstCell || !totalCell) return;

            if (totalCell.textContent.trim().toUpperCase().includes('N/A')) return;

            const slotText = firstCell.querySelector('.datatable-body-cell-label-inner')?.textContent?.trim()
                          || firstCell.textContent.trim();
            const slotId = parseInt(slotText, 10);

            if (!isNaN(slotId) && slotCache.has(slotId)) {
                const events = slotCache.get(slotId);
                const innerP = totalCell.querySelector('p.datatable-body-cell-label-inner');
                if (!innerP) return;

                let badge = innerP.querySelector('.noc-slot-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    innerP.appendChild(badge);
                }

                const count = events.length;
                badge.className = `noc-slot-badge ${count > 0 ? 'noc-badge-alert' : 'noc-badge-ok'}`;
                badge.textContent = count;
                badge.title = `Slot ${slotId}: ${count} evento(s). Clic para abrir auditoría.`;
                badge.onclick = (e) => {
                    e.stopPropagation();
                    openDrawerImmediate();
                };
            }
        });
    }

    // Inyectar botón disparador en la cabecera
    function injectTriggerButton() {
        if (document.getElementById('btn-trigger-noc-drawer')) return;

        const subtitleContainer = document.querySelector('.blockpanel-subtitle');
        if (!subtitleContainer) return;

        const button = document.createElement('button');
        button.id = 'btn-trigger-noc-drawer';
        button.className = 'btn-audit-trigger';
        button.innerHTML = `<i class="fa fa-list-alt"></i> Auditar Caídas de Slots`;
        button.onclick = (e) => {
            e.preventDefault();
            openDrawerImmediate();
        };

        subtitleContainer.appendChild(button);
    }

    // Verificación de la vista
    function processView() {
        const oltId = getOltIdFromUrl();
        const token = getToken();
        if (!oltId || !token) return;

        injectTriggerButton();

        // Si cambió de OLT
        if (currentOltId !== oltId) {
            currentOltId = oltId;
            lastTelemetryTimestamp = null;
            slotCache.clear();
            currentResults = [];
            document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
            const drawerOverlay = document.getElementById('noc-drawer-overlay-root');
            if (drawerOverlay) drawerOverlay.remove();
        }

        // Si se actualizó la fecha de telemetría en la misma OLT
        const timestampEl = document.querySelector('.blockpanel-title span.label-primary.pull-right');
        if (timestampEl) {
            const currentTs = timestampEl.textContent.trim();
            if (lastTelemetryTimestamp && lastTelemetryTimestamp !== currentTs) {
                slotCache.clear();
                document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
            }
            lastTelemetryTimestamp = currentTs;
        }

        syncTableBadges();
    }

    // Escucha SPA Router
    const handleUrlChange = () => setTimeout(processView, 200);
    window.addEventListener('popstate', handleUrlChange);

    const origPush = history.pushState;
    history.pushState = function () {
        origPush.apply(this, arguments);
        handleUrlChange();
    };

    const origReplace = history.replaceState;
    history.replaceState = function () {
        origReplace.apply(this, arguments);
        handleUrlChange();
    };

    // Observer reactivo
    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(processView, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(processView, 800);
})();

// ==UserScript==
// @name         InCa ACS - NOC Slot Outage Monitor
// @namespace    Violentmonkey Scripts
// @version      4.8
// @description  Auditoría de estabilidad y telemetría por tarjeta (Slots PON) bajo demanda.
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

    // Control de cancelación y condición de carrera entre OLTs/consultas
    let activeAuditRunId = 0;
    let activeAuditController = null;

    const CONCURRENCY_LIMIT = 3;
    const FETCH_TIMEOUT_MS = 10000;

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

            --noc-yellow-bg: #382d13;
            --noc-yellow-border: #69521e;
            --noc-yellow-text: #f5b041;

            --noc-blue-accent: #3d8bfd;
            --noc-blue-hover: #2b77e5;
        }

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
        .noc-badge-error {
            background: var(--noc-yellow-bg);
            border-color: var(--noc-yellow-border);
            color: var(--noc-yellow-text);
        }

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
            font-size: 13px;
            font-weight: 700;
            color: var(--noc-text-main);
            display: flex;
            align-items: center;
            gap: 8px;
            letter-spacing: 0.3px;
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
            transition: width 0.15s ease;
        }

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
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            color: var(--noc-text-muted);
        }
        .noc-summary-bar strong { color: var(--noc-text-main); }

        .noc-empty-placeholder {
            text-align: center;
            color: var(--noc-text-muted);
            padding: 50px 20px;
            font-size: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            line-height: 1.5;
        }
        .noc-empty-placeholder i {
            font-size: 28px;
            color: var(--noc-text-dim);
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

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
        return titleEl?.textContent?.trim() || `OLT-${getOltIdFromUrl() || 'N/A'}`;
    }

    function isNaValue(val) {
        if (val === null || val === undefined) return true;
        if (typeof val === 'string') {
            const clean = val.trim().toUpperCase();
            if (clean === 'N/A' || clean === 'NA' || clean === '') return true;
        }
        return false;
    }

    function parseDateSafe(dateStr) {
        if (!dateStr) return null;
        if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

        let normalized = dateStr;
        if (typeof dateStr === 'string') {
            const trimmed = dateStr.trim();
            const hasTimezone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
            normalized = hasTimezone ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
        }

        const d = new Date(normalized);
        if (!isNaN(d.getTime())) return d;

        const fallback = new Date(dateStr);
        return isNaN(fallback.getTime()) ? null : fallback;
    }

    function formatDate(dateObj) {
        if (!dateObj) return '';
        return dateObj.toLocaleString('es-VE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    function getSlotIdFromCell(cell) {
        if (!cell) return null;
        const targetNode = cell.querySelector('.datatable-body-cell-label-inner') || cell;
        const rawText = targetNode.textContent.trim();
        const match = rawText.match(/\b\d+\b/);
        if (!match) return null;
        const id = parseInt(match[0], 10);
        return isNaN(id) ? null : id;
    }

    function parseOutageEvents(data) {
        if (!Array.isArray(data) || data.length === 0) return [];

        const sorted = data
            .map(item => ({
                item,
                ts: parseDateSafe(item.createdAt)?.getTime() ?? 0
            }))
            .sort((a, b) => a.ts - b.ts);

        const events = [];
        let inOutage = false;
        let outageStart = null;
        let outageStartTs = 0;

        for (let i = 0; i < sorted.length; i++) {
            const { item, ts } = sorted[i];
            if (isNaValue(item.online)) continue;

            const online = Number(item.online);
            const offline = Number(item.offline) || 0;
            const suspended = Number(item.suspended) || 0;
            const totalOnus = online + offline + suspended;

            if (isNaN(online) || totalOnus === 0) continue;

            if (online === 0) {
                if (!inOutage) {
                    inOutage = true;
                    outageStart = item.createdAt;
                    outageStartTs = ts;
                }
            } else if (inOutage) {
                inOutage = false;
                const diffMin = (outageStartTs && ts)
                    ? Math.max(1, Math.round((ts - outageStartTs) / 60000))
                    : 0;
                events.push({
                    start: outageStart,
                    end: item.createdAt,
                    duration: `${diffMin} min`
                });
                outageStart = null;
                outageStartTs = 0;
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

    async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, externalSignal = null) {
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
            return await fetch(url, {
                ...options,
                signal: controller.signal
            });
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

    async function fetchSlotWithRetry(oltId, slotId, token, options = {}) {
        const {
            forceRefresh = false,
            maxRetries = 3,
            signal = null
        } = options;

        if (!forceRefresh && slotCache.has(slotId)) {
            return slotCache.get(slotId);
        }

        const filter = encodeURIComponent(JSON.stringify({ order: 'createdAt ASC', include: {} }));
        const url = `${window.location.origin}/api/fttx/monitoring/olt-usage/${oltId}/statuses/slots/${slotId}?filter=${filter}`;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (signal?.aborted) {
                return { events: [], status: 'ABORTED' };
            }

            try {
                const resp = await fetchWithTimeout(url, {
                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'x-access-token': token
                    }
                }, FETCH_TIMEOUT_MS, signal);

                if (resp.status === 404) {
                    return { events: [], status: 'UNAVAILABLE' };
                }

                // Errores de cliente no transitorios (ej. 401/403) no deben reintentarse
                if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
                    const msg = resp.status === 401 || resp.status === 403
                        ? `Acceso denegado (HTTP ${resp.status})`
                        : `HTTP ${resp.status}`;
                    return { events: [], status: 'ERROR', errorMsg: msg };
                }

                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

                const data = await resp.json();
                if (Array.isArray(data)) {
                    const events = parseOutageEvents(data);
                    return { events, status: 'OK' };
                }
                throw new Error('Respuesta no válida');
            } catch (e) {
                if (signal?.aborted) {
                    return { events: [], status: 'ABORTED' };
                }
                if (attempt === maxRetries) {
                    const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
                    return {
                        events: [],
                        status: 'ERROR',
                        errorMsg: isTimeout ? 'Timeout' : e.message
                    };
                }
                try {
                    await sleepAbortable(attempt * 300, signal);
                } catch {
                    return { events: [], status: 'ABORTED' };
                }
            }
        }

        return { events: [], status: 'ERROR', errorMsg: 'Sin respuesta del host' };
    }

    async function runWorkerPool(items, limit, handler) {
        const results = new Array(items.length);
        let currentIndex = 0;
        const total = items.length;
        const workerCount = Math.min(limit, total);

        const workers = Array.from({ length: workerCount }, async () => {
            while (currentIndex < total) {
                const index = currentIndex++;
                results[index] = await handler(items[index]);
            }
        });

        await Promise.all(workers);
        return results;
    }

    function extractActiveSlotsFromDOM() {
        const table = document.querySelector('table.olt-usage-details-datatable');
        if (!table) return [];

        const rows = table.querySelectorAll('tbody tr');
        const seen = new Set();

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) return;

            const lastCellText = cells[cells.length - 1].textContent.trim().toUpperCase();
            if (lastCellText.includes('N/A')) return;

            const slotId = getSlotIdFromCell(cells[0]);
            if (slotId !== null) {
                seen.add(slotId);
            }
        });

        return Array.from(seen).sort((a, b) => a - b);
    }

    function renderCardsInsideDrawer(results) {
        const bodyEl = document.getElementById('noc-drawer-body-container');
        if (!bodyEl) return;

        if (!results || results.length === 0) {
            bodyEl.innerHTML = `
                <div class="noc-empty-placeholder">
                    <i class="fa fa-info-circle"></i>
                    <span>No se encontraron tarjetas con telemetría disponible para esta OLT.</span>
                </div>
            `;
            return;
        }

        let totalEventsCount = 0;
        let slotsWithOutages = 0;
        let slotsWithErrors = 0;

        const cardsHtml = results.map(item => {
            const isError = item.status === 'ERROR';
            const count = item.events.length;

            if (isError) {
                slotsWithErrors++;
            } else {
                totalEventsCount += count;
                if (count > 0) slotsWithOutages++;
            }

            let statusBadge = '';
            if (isError) {
                statusBadge = `<span class="noc-slot-badge noc-badge-error">Fallo de lectura</span>`;
            } else if (count > 0) {
                statusBadge = `<span class="noc-slot-badge noc-badge-alert">${count} interrupción(es)</span>`;
            } else {
                statusBadge = `<span class="noc-slot-badge noc-badge-ok">Operativa</span>`;
            }

            let eventsList = '';
            if (isError) {
                eventsList = `<div style="font-size: 11px; color: var(--noc-yellow-text);">No fue posible obtener la telemetría del slot (${escapeHtml(item.errorMsg || 'Tiempo agotado')}).</div>`;
            } else if (count > 0) {
                eventsList = `<div class="noc-events-list">
                    ${item.events.map(ev => `
                        <div class="noc-event-row">
                            <div class="noc-event-dates">
                                <span style="color: var(--noc-red-text);">Inicio: ${escapeHtml(formatDate(parseDateSafe(ev.start)))}</span>
                                <span style="color: ${ev.end ? 'var(--noc-green-text)' : 'var(--noc-red-text)'};">
                                    ${ev.end ? `Restablecido: ${escapeHtml(formatDate(parseDateSafe(ev.end)))}` : 'Estado: Afectación en curso'}
                                </span>
                            </div>
                            <span class="noc-event-badge-dur">${escapeHtml(ev.duration)}</span>
                        </div>
                    `).join('')}
                   </div>`;
            } else {
                eventsList = `<div style="font-size: 11px; color: var(--noc-text-dim);">Sin registros de pérdida de servicio (online = 0).</div>`;
            }

            return `
                <div class="noc-slot-card">
                    <div class="noc-card-header">
                        <span class="noc-card-title">Slot ${escapeHtml(item.slotId)}</span>
                        ${statusBadge}
                    </div>
                    ${eventsList}
                </div>
            `;
        }).join('');

        bodyEl.innerHTML = `
            <div class="noc-summary-bar">
                <span>Tarjetas evaluadas: <strong>${results.length}</strong></span>
                <span>Con afectación: <strong style="color: var(--noc-red-text);">${slotsWithOutages}</strong></span>
                <span>Eventos registrados: <strong style="color: var(--noc-red-text);">${totalEventsCount}</strong></span>
                ${slotsWithErrors > 0 ? `<span>Sin respuesta: <strong style="color: var(--noc-yellow-text);">${slotsWithErrors}</strong></span>` : ''}
            </div>
            ${cardsHtml}
        `;
    }

    async function copyReportToClipboard() {
        if (!currentResults || currentResults.length === 0) return;

        const btnCopy = document.getElementById('btn-modal-copy-report');
        const oltName = getOltName();
        const oltId = getOltIdFromUrl();
        const now = formatDate(new Date());

        let totalEvents = 0;
        const affectedSlots = [];
        const cleanSlots = [];
        const errorSlots = [];

        currentResults.forEach(item => {
            if (item.status === 'ERROR') {
                errorSlots.push(item.slotId);
            } else if (item.events.length > 0) {
                totalEvents += item.events.length;
                affectedSlots.push(item);
            } else {
                cleanSlots.push(item.slotId);
            }
        });

        const lines = [
            `=================================================================`,
            `   REPORTE DE ESTABILIDAD POR SLOTS (CAÍDAS MASIVAS) - NOC`,
            `=================================================================`,
            `Dispositivo:          ${oltName} (ID: ${oltId})`,
            `Fecha de emisión:     ${now}`,
            `Tarjetas auditadas:   ${currentResults.length}`,
            `Tarjetas afectadas:   ${affectedSlots.length}`,
            `Total interrupciones: ${totalEvents}`,
            ...(errorSlots.length > 0 ? [`Sin telemetría:       Slot(s) ${errorSlots.join(', ')}`] : []),
            `=================================================================`,
            ``
        ];

        if (affectedSlots.length > 0) {
            lines.push(`[ DETALLE DE INTERRUPCIONES DETECTADAS ]`);
            lines.push(`-----------------------------------------------------------------`);
            affectedSlots.forEach(item => {
                lines.push(`\n* SLOT ${item.slotId} :: [${item.events.length} Evento(s)]`);
                item.events.forEach((ev, idx) => {
                    const start = formatDate(parseDateSafe(ev.start));
                    const end = ev.end ? formatDate(parseDateSafe(ev.end)) : 'En curso';
                    lines.push(`  [#${idx + 1}] Inicio: ${start} | Restablecido: ${end} | Duración: ${ev.duration}`);
                });
            });
            lines.push(`\n-----------------------------------------------------------------`);
        } else {
            lines.push(`[+] Sin eventos críticos detectados en las tarjetas evaluadas.\n`);
        }

        if (cleanSlots.length > 0) {
            lines.push(`\n[ TARJETAS OPERATIVAS / SIN CAÍDAS ]`);
            lines.push(`Slots: ${cleanSlots.join(', ')}`);
        }

        lines.push(`\n=================================================================`);
        const txt = lines.join('\n') + '\n';

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(txt);
            } else {
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
                btnCopy.innerHTML = `<i class="fa fa-check" style="color: var(--noc-green-text);"></i> Copiado`;
                btnCopy.style.borderColor = 'var(--noc-green-text)';
                setTimeout(() => {
                    if (document.body.contains(btnCopy)) {
                        btnCopy.innerHTML = originalHtml;
                        btnCopy.style.borderColor = 'var(--noc-border-subtle)';
                    }
                }, 2000);
            }
        } catch {
            alert('No se pudo copiar el reporte al portapapeles.');
        }
    }

    function showDrawerMessage(iconClass, message, colorVar = 'var(--noc-text-dim)') {
        const bodyEl = document.getElementById('noc-drawer-body-container');
        if (!bodyEl) return;
        bodyEl.innerHTML = `
            <div class="noc-empty-placeholder">
                <i class="fa ${escapeHtml(iconClass)}" style="color: ${escapeHtml(colorVar)};"></i>
                <span>${escapeHtml(message)}</span>
            </div>
        `;
    }

    async function executeQueryFromModal() {
        if (isFetching) return;

        const oltId = getOltIdFromUrl();
        const token = getToken();
        if (!oltId || !token) {
            showDrawerMessage('fa-exclamation-triangle', 'No se detectó sesión activa o ID de OLT válido. Recargue la página si su sesión expiró.', 'var(--noc-yellow-text)');
            return;
        }

        const validSlots = extractActiveSlotsFromDOM();
        if (validSlots.length === 0) {
            showDrawerMessage('fa-table', 'No se encontraron tarjetas activas en la tabla. Espere a que cargue la vista e intente nuevamente.', 'var(--noc-yellow-text)');
            return;
        }

        const btnQuery = document.getElementById('btn-modal-query-action');
        const btnCopy = document.getElementById('btn-modal-copy-report');
        const bodyEl = document.getElementById('noc-drawer-body-container');

        if (btnQuery) btnQuery.disabled = true;
        if (btnCopy) btnCopy.disabled = true;

        if (activeAuditController) {
            activeAuditController.abort();
        }
        activeAuditController = new AbortController();
        const runId = ++activeAuditRunId;
        const auditSignal = activeAuditController.signal;

        isFetching = true;
        slotCache.clear();
        currentResults = [];

        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="noc-progress-container">
                    <div class="noc-progress-header">
                        <span id="noc-progress-label">Iniciando análisis de telemetría...</span>
                        <span id="noc-progress-pct">0%</span>
                    </div>
                    <div class="noc-progress-track">
                        <div class="noc-progress-fill" id="noc-progress-fill-bar"></div>
                    </div>
                </div>
                <div class="noc-empty-placeholder" style="padding: 30px;">
                    <i class="fa fa-spinner fa-spin" style="color: var(--noc-blue-accent);"></i>
                    <span>Consultando historial de tráfico...</span>
                </div>
            `;
        }

        const total = validSlots.length;
        let completed = 0;

        try {
            const results = await runWorkerPool(validSlots, CONCURRENCY_LIMIT, async (slotId) => {
                const res = await fetchSlotWithRetry(oltId, slotId, token, {
                    forceRefresh: true,
                    signal: auditSignal
                });

                if (runId !== activeAuditRunId || auditSignal.aborted) {
                    return null;
                }

                if (res.status !== 'ABORTED') {
                    slotCache.set(slotId, res);
                }

                completed++;
                const pct = Math.round((completed / total) * 100);
                const progressLabel = document.getElementById('noc-progress-label');
                const progressPct = document.getElementById('noc-progress-pct');
                const progressBar = document.getElementById('noc-progress-fill-bar');

                if (progressLabel) progressLabel.textContent = `Procesado Slot ${slotId} (${completed} de ${total})`;
                if (progressPct) progressPct.textContent = `${pct}%`;
                if (progressBar) progressBar.style.width = `${pct}%`;

                return {
                    slotId,
                    events: res.events,
                    status: res.status,
                    errorMsg: res.errorMsg
                };
            });

            if (runId !== activeAuditRunId || oltId !== currentOltId) {
                return;
            }

            const filteredResults = results.filter(
                r => r && r.status !== 'UNAVAILABLE' && r.status !== 'ABORTED'
            );

            filteredResults.sort((a, b) => {
                if (a.status === 'ERROR' && b.status !== 'ERROR') return -1;
                if (b.status === 'ERROR' && a.status !== 'ERROR') return 1;
                return b.events.length - a.events.length || a.slotId - b.slotId;
            });

            currentResults = filteredResults;

            renderCardsInsideDrawer(filteredResults);
            syncTableBadges();

            const currentBtnCopy = document.getElementById('btn-modal-copy-report');
            if (currentBtnCopy) currentBtnCopy.disabled = filteredResults.length === 0;
        } finally {
            if (runId === activeAuditRunId) {
                isFetching = false;
                activeAuditController = null;
                const currentBtnQuery = document.getElementById('btn-modal-query-action');
                if (currentBtnQuery) {
                    currentBtnQuery.disabled = false;
                    currentBtnQuery.innerHTML = `<i class="fa fa-refresh"></i> Actualizar Datos`;
                }
            }
        }
    }

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
                        Auditoría de Estabilidad por Slot
                    </div>
                    <button class="noc-drawer-close" id="btn-close-noc-drawer">&times;</button>
                </div>
                <div class="noc-drawer-toolbar">
                    <button class="btn-modal-action" id="btn-modal-query-action">
                        <i class="fa fa-search"></i> Consultar Telemetría
                    </button>
                    <button class="btn-modal-copy" id="btn-modal-copy-report" disabled title="Disponible tras completar la consulta">
                        <i class="fa fa-clipboard"></i> Copiar Reporte
                    </button>
                </div>
                <div class="noc-drawer-body" id="noc-drawer-body-container">
                    <div class="noc-empty-placeholder">
                        <i class="fa fa-line-chart"></i>
                        <span>Seleccione <strong>"Consultar Telemetría"</strong> para auditar las tarjetas activas de esta OLT y verificar eventos de pérdida total de abonados (online = 0).</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const btnQuery = document.getElementById('btn-modal-query-action');
        const btnCopy = document.getElementById('btn-modal-copy-report');

        btnQuery.onclick = executeQueryFromModal;
        btnCopy.onclick = copyReportToClipboard;

        // Rehidratar estado previo si el usuario cerró y reabrió el panel
        if (isFetching) {
            btnQuery.disabled = true;
            showDrawerMessage('fa-spinner fa-spin', 'Consulta en curso... Espere un momento.', 'var(--noc-blue-accent)');
        } else if (currentResults.length > 0) {
            renderCardsInsideDrawer(currentResults);
            btnCopy.disabled = false;
            btnQuery.innerHTML = `<i class="fa fa-refresh"></i> Actualizar Datos`;
        }

        const escListener = (e) => {
            if (e.key === 'Escape') {
                close();
            }
        };

        const close = () => {
            document.removeEventListener('keydown', escListener);
            overlay.remove();
        };

        document.getElementById('btn-close-noc-drawer').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        document.addEventListener('keydown', escListener);
    }

    function syncTableBadges() {
        if (slotCache.size === 0) return;

        const table = document.querySelector('table.olt-usage-details-datatable');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) return;

            const totalCell = cells[cells.length - 1];
            if (totalCell.textContent.trim().toUpperCase().includes('N/A')) return;

            const slotId = getSlotIdFromCell(cells[0]);
            if (slotId === null || !slotCache.has(slotId)) return;

            const data = slotCache.get(slotId);
            if (data.status === 'UNAVAILABLE' || data.status === 'ABORTED') return;

            const container = totalCell.querySelector('p.datatable-body-cell-label-inner') || totalCell;

            let badge = container.querySelector('.noc-slot-badge');
            if (!badge) {
                badge = document.createElement('span');
                container.appendChild(badge);
            }

            if (data.status === 'ERROR') {
                badge.className = 'noc-slot-badge noc-badge-error';
                badge.textContent = '!';
                badge.title = `Slot ${slotId}: Error de comunicación. Clic para ver detalles.`;
            } else {
                const count = data.events.length;
                badge.className = `noc-slot-badge ${count > 0 ? 'noc-badge-alert' : 'noc-badge-ok'}`;
                badge.textContent = count;
                badge.title = `Slot ${slotId}: ${count} evento(s) registrado(s). Clic para abrir auditoría.`;
            }

            badge.onclick = (e) => {
                e.stopPropagation();
                openDrawerImmediate();
            };
        });
    }

    function injectTriggerButton() {
        if (document.getElementById('btn-trigger-noc-drawer')) return;

        const subtitleContainer = document.querySelector('.blockpanel-subtitle');
        if (!subtitleContainer) return;

        const button = document.createElement('button');
        button.id = 'btn-trigger-noc-drawer';
        button.className = 'btn-audit-trigger';
        button.innerHTML = `<i class="fa fa-list-alt"></i> Auditoría de Tarjetas`;
        button.onclick = (e) => {
            e.preventDefault();
            openDrawerImmediate();
        };

        subtitleContainer.appendChild(button);
    }

    function resetAuditState() {
        activeAuditRunId++;
        if (activeAuditController) {
            activeAuditController.abort();
            activeAuditController = null;
        }
        isFetching = false;
        slotCache.clear();
        currentResults = [];
        document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
    }

    function processView() {
        const oltId = getOltIdFromUrl();
        const token = getToken();
        if (!oltId || !token) return;

        injectTriggerButton();

        if (currentOltId !== oltId) {
            currentOltId = oltId;
            lastTelemetryTimestamp = null;
            resetAuditState();
            const drawerOverlay = document.getElementById('noc-drawer-overlay-root');
            if (drawerOverlay) drawerOverlay.remove();
        }

        const timestampEl = document.querySelector('.blockpanel-title span.label-primary.pull-right');
        if (timestampEl) {
            const currentTs = timestampEl.textContent.trim();
            if (lastTelemetryTimestamp && lastTelemetryTimestamp !== currentTs) {
                if (!isFetching) {
                    slotCache.clear();
                    currentResults = [];
                    document.querySelectorAll('.noc-slot-badge').forEach(b => b.remove());
                }
            }
            lastTelemetryTimestamp = currentTs;
        }

        syncTableBadges();

        // Descartar mutaciones causadas por este mismo ciclo para no re-disparar el observer
        observer.takeRecords();
    }

    const handleUrlChange = () => setTimeout(processView, 200);
    window.addEventListener('popstate', handleUrlChange);

    const origPush = history.pushState;
    history.pushState = function () {
        const ret = origPush.apply(this, arguments);
        handleUrlChange();
        return ret;
    };

    const origReplace = history.replaceState;
    history.replaceState = function () {
        const ret = origReplace.apply(this, arguments);
        handleUrlChange();
        return ret;
    };

    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(processView, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(processView, 800);
})();

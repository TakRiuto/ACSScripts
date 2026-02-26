// ==UserScript==
// @name        Multi-Locate ONT
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/fttx/locate-ont*
// @grant       none
// @version     2
// @author      Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function() {
    'use strict';

    const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function esperarPace() {
        return new Promise((resolve) => {
            if (document.body.classList.contains('pace-done')) {
                setTimeout(resolve, 500);
                return;
            }
            const obs = new MutationObserver(() => {
                if (document.body.classList.contains('pace-done')) {
                    obs.disconnect();
                    setTimeout(resolve, 500);
                }
            });
            obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            setTimeout(() => { obs.disconnect(); resolve(); }, 8000);
        });
    }

    // Espera a que el botón esté habilitado antes de clickearlo
    function esperarBotonListo(btn, timeout = 5000) {
        return new Promise((resolve) => {
            if (!btn.disabled) { resolve(); return; }
            const check = setInterval(() => {
                if (!btn.disabled) { clearInterval(check); resolve(); }
            }, 50);
            setTimeout(() => { clearInterval(check); resolve(); }, timeout);
        });
    }

    function inyectarPanel() {
        if (document.getElementById('vm-custom-filter')) return;
        const mainRow = document.querySelector('input[formcontrolname="serialNumber"]')?.closest('.row');
        if (!mainRow) { setTimeout(inyectarPanel, 1000); return; }

        const panel = document.createElement('div');
        panel.id = 'vm-custom-filter';
        panel.style.cssText = `background:#f4f4f4; border:2px solid #1ab394; padding:15px; margin-bottom:15px; border-radius:5px;`;
        panel.innerHTML = `
            <div style="display:flex; gap:15px; align-items:flex-start;">
                <div style="flex-grow: 1;">
                    <label style="font-weight:bold; font-size:14px;">Lista de Seriales para Reporte:</label>
                    <textarea id="vm-seriales-input" class="form-control" style="height: 100px; font-family:monospace;" placeholder="Pega los seriales aquí..."></textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:25px;">
                    <button id="vm-btn-start" class="btn btn-primary" style="font-weight:bold; min-width:180px; background:#1ab394;">Multi-Busqueda</button>
                    <button id="vm-btn-reset" class="btn btn-danger btn-sm" style="font-weight:bold;">Restablecer</button>
                </div>
            </div>
            <div id="vm-log" style="font-size:11px; color:#555; margin-top:5px;">Listo para procesar.</div>
        `;

        const resultadosDiv = document.createElement('div');
        resultadosDiv.id = 'vm-reporte-final';
        resultadosDiv.style.cssText = 'display:none; margin-top:20px; border-top: 3px solid #1ab394; padding-top:20px;';

        const estilo = document.createElement('style');
        estilo.innerHTML = `
            #vm-reporte-final .table-collapsed-row { display: table-row !important; visibility: visible !important; }
            #vm-reporte-final .list-group { display: block !important; }
            #vm-reporte-final a { pointer-events: none !important; cursor: default !important; text-decoration: none !important; color: inherit !important; }
            .vm-item-header { background: #1ab394; color: white; padding: 8px; font-weight: bold; margin-top: 20px; border-radius: 3px 3px 0 0; }
            .vm-item-header.not-found { background: #e74c3c; }
            .vm-table-wrap { border: 1px solid #1ab394; background: white; margin-bottom: 10px; }
            #vm-overlay-cancel {
                margin-top: 20px; padding: 8px 24px; background: #e74c3c; color: white;
                border: none; border-radius: 4px; font-size: 14px; font-weight: bold;
                cursor: pointer;
            }
            #vm-overlay-cancel:hover { background: #c0392b; }
        `;
        (document.head || document.documentElement).appendChild(estilo);

        mainRow.parentNode.insertBefore(panel, mainRow);
        mainRow.parentNode.insertBefore(resultadosDiv, mainRow);

        // --- BÚSQUEDA ---
        let cancelado = false;

        document.getElementById('vm-btn-start').addEventListener('click', async function() {
            const inputTxt = document.getElementById('vm-seriales-input').value;
            const seriales = inputTxt.split(/[\n, ]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
            if (seriales.length === 0) return alert("No hay seriales para buscar.");

            const inputOrig = document.querySelector('input[formcontrolname="serialNumber"]');
            const btnOrig = document.querySelector('button[type="submit"]');

            // Overlay con botón cancelar
            cancelado = false;
            const overlay = document.createElement('div');
            overlay.id = 'vm-overlay';
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
            overlay.innerHTML = `
                <h2 style="color:#1ab394;">Generando Reporte...</h2>
                <p id="vm-p">Iniciando...</p>
                <div id="vm-progress" style="width:300px; background:#444; border-radius:4px; margin-top:10px; height:8px;">
                    <div id="vm-progress-bar" style="width:0%; height:8px; background:#1ab394; border-radius:4px; transition: width 0.3s;"></div>
                </div>
                <button id="vm-overlay-cancel">✖ Cancelar</button>
            `;
            document.body.appendChild(overlay);

            document.getElementById('vm-overlay-cancel').onclick = () => { cancelado = true; };

            let totalHtml = "";
            let encontrados = 0;
            let noEncontrados = 0;

            for (let i = 0; i < seriales.length; i++) {
                if (cancelado) break;

                const s = seriales[i];
                document.getElementById('vm-p').innerText = `Buscando (${i + 1}/${seriales.length}): ${s}`;
                document.getElementById('vm-progress-bar').style.width = `${((i + 1) / seriales.length) * 100}%`;

                inputOrig.value = s;
                inputOrig.dispatchEvent(new Event('input', { bubbles: true }));

                // Esperar a que el botón esté listo antes de clickear
                await esperarBotonListo(btnOrig);
                btnOrig.click();

                await esperarPace();

                const flecha = document.querySelector('a.fa-chevron-right');
                if (flecha) {
                    flecha.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    // Esperar pace en lugar de delay fijo
                    await esperarPace();
                }

                const tbody = document.querySelector('.table-container tbody');
                if (tbody) {
                    totalHtml += `<div class="vm-item-header">SERIAL: ${s}</div>`;
                    totalHtml += `<div class="vm-table-wrap"><table class="table table-custom-striped"><tbody>${tbody.innerHTML}</tbody></table></div>`;
                    encontrados++;
                } else {
                    totalHtml += `<div class="vm-item-header not-found">SERIAL: ${s} — NO ENCONTRADO</div>`;
                    noEncontrados++;
                }
            }

            document.body.removeChild(overlay);

            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) tableContainer.style.display = 'none';

            const resumen = cancelado
                ? `<p style="color:#e74c3c; font-weight:bold;">⚠️ Búsqueda cancelada en serial ${seriales[encontrados + noEncontrados] || '?'}.</p>`
                : `<p style="color:#555;">✅ Encontrados: <b>${encontrados}</b> &nbsp;|&nbsp; ❌ No encontrados: <b style="color:#e74c3c;">${noEncontrados}</b></p>`;

            resultadosDiv.innerHTML = `<h3>Reporte Consolidado</h3>${resumen}` + totalHtml;
            resultadosDiv.style.display = 'block';
        });

        // --- RESET ---
        document.getElementById('vm-btn-reset').addEventListener('click', async function() {
            cancelado = true;
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) tableContainer.style.display = 'block';
            resultadosDiv.style.display = 'none';
            resultadosDiv.innerHTML = '';

            const btnBack = document.querySelector('i.fa-fast-backward')?.closest('button');
            if (btnBack && !btnBack.disabled) {
                btnBack.click();
                await esperarPace();
            }
            const btnRefresh = document.querySelector('i.fa-refresh')?.closest('button');
            if (btnRefresh) btnRefresh.click();

            cancelado = false;
        });
    }

    setTimeout(inyectarPanel, 1500);
})();

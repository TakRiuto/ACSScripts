// ==UserScript==
// @name         Filtro Múltiple de Seriales ONU - TODO
// @namespace    Violentmonkey Scripts
// @match        *://190.153.58.82/fttx/todo*
// @grant        none
// @version      2.3
// @author       Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiTODO.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiTODO.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function() {
    'use strict';

    const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function esperarQuePaceTermine() {
        return new Promise((resolve) => {
            const paceDiv = document.querySelector('.pace');
            if (!paceDiv || paceDiv.classList.contains('pace-inactive')) {
                setTimeout(resolve, 600);
                return;
            }
            const observador = new MutationObserver(() => {
                if (paceDiv.classList.contains('pace-inactive')) {
                    observador.disconnect();
                    setTimeout(resolve, 600);
                }
            });
            observador.observe(paceDiv, { attributes: true, attributeFilter: ['class'] });
            setTimeout(() => { observador.disconnect(); resolve(); }, 8000);
        });
    }

    function presentarResultados(filas, paginas, cancelado) {
        const tablaOriginal = document.querySelector('.table-container table');
        const thead = tablaOriginal.querySelector('thead').outerHTML;
        document.querySelector('.table-container').style.display = 'none';

        const resultadosDiv = document.getElementById('vm-resultados-totales');
        resultadosDiv.style.display = 'block';

        const alertColor = cancelado
            ? 'background:#fcf8e3; color:#8a6d3b; border:1px solid #faebcc;'
            : 'background:#d9edf7; color:#31708f; border:1px solid #bce8f1;';
        const alertMsg = cancelado
            ? `⚠️ <b>Escaneo cancelado.</b> Se encontraron <b>${filas.length}</b> coincidencias en <b>${paginas}</b> páginas escaneadas.`
            : `✅ <b>Escaneo finalizado:</b> Se encontraron <b>${filas.length}</b> coincidencias en <b>${paginas}</b> páginas.`;

        resultadosDiv.innerHTML = `
            <div class="alert" style="${alertColor} padding:15px; border-radius:4px; margin-bottom:20px;">
                <i class="fa fa-info-circle"></i> ${alertMsg}
            </div>
            <table class="${tablaOriginal.className}" style="background:white; width:100%; border:1px solid #e7eaec;">
                ${thead}
                <tbody>${filas.length > 0
                    ? filas.join('')
                    : '<tr><td colspan="20" class="text-center">No se encontraron seriales en ninguna página.</td></tr>'
                }</tbody>
            </table>
        `;
    }

    function inyectarPanel() {
        if (document.getElementById('vm-custom-filter')) return;
        const tableContainer = document.querySelector('.table-container');
        if (!tableContainer) { setTimeout(inyectarPanel, 2000); return; }

        const panel = document.createElement('div');
        panel.id = 'vm-custom-filter';
        panel.style.cssText = `background:#f8f9fa; border:1px solid #e7eaec; padding:15px; margin-bottom:15px; border-radius:3px; display:flex; gap:15px; align-items:flex-start;`;
        panel.innerHTML = `
            <div style="flex-grow: 1;">
                <label style="font-weight:600; font-size:13px;">Buscador Múltiple (Seriales):</label>
                <textarea id="vm-seriales-input" class="form-control" style="height: 60px; resize: vertical; width: 100%;" placeholder="Pega los seriales aquí..."></textarea>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:25px;">
                <button id="vm-btn-escanear" class="btn btn-warning btn-sm" style="min-width:170px; font-weight:bold; background:#ffc107; color:#000;">Filtrado Global</button>
                <button id="vm-btn-limpiar" class="btn btn-danger btn-sm" style="min-width:170px; font-weight:bold;">Restaurar y Refrescar</button>
            </div>
        `;

        const resultadosDiv = document.createElement('div');
        resultadosDiv.id = 'vm-resultados-totales';
        resultadosDiv.style.display = 'none';

        tableContainer.parentNode.insertBefore(panel, tableContainer);
        tableContainer.parentNode.insertBefore(resultadosDiv, tableContainer);

        // --- ESCANEO ---
        let cancelado = false;

        document.getElementById('vm-btn-escanear').addEventListener('click', async function() {
            const inputVal = document.getElementById('vm-seriales-input').value;
            const seriales = inputVal.split(/[\n, ]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
            if (seriales.length === 0) return alert("Ingresa seriales.");

            cancelado = false;

            const overlay = document.createElement('div');
            overlay.id = 'vm-overlay';
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
            overlay.innerHTML = `
                <h2 style="color:#ffc107;">Escaneando Red...</h2>
                <p id="vm-progress" style="font-size:18px;">Iniciando...</p>
                <div style="width:300px; background:#444; border-radius:4px; margin-top:10px; height:8px;">
                    <div id="vm-progress-bar" style="width:0%; height:8px; background:#ffc107; border-radius:4px; transition:width 0.3s;"></div>
                </div>
                <button id="vm-overlay-cancel" style="margin-top:20px; padding:8px 24px; background:#e74c3c; color:white; border:none; border-radius:4px; font-size:14px; font-weight:bold; cursor:pointer;">✖ Cancelar</button>
            `;
            document.body.appendChild(overlay);
            document.getElementById('vm-overlay-cancel').onclick = () => { cancelado = true; };

            const filasEncontradasHTML = [];
            let paginaActual = 1;

            try {
                while (true) {
                    if (cancelado) break;

                    document.querySelectorAll('.table-container table tbody tr').forEach(f => {
                        const t = f.textContent.toUpperCase();
                        if (seriales.some(s => t.includes(s))) filasEncontradasHTML.push(f.outerHTML);
                    });

                    const btnNext = document.querySelector('i.fa-chevron-right')?.closest('button');
                    if (!btnNext || btnNext.disabled || btnNext.classList.contains('disabled')) break;

                    btnNext.click();
                    paginaActual++;

                    document.getElementById('vm-progress').innerText = `Página ${paginaActual} — Coincidencias: ${filasEncontradasHTML.length}`;
                    // Animar barra indeterminada (no sabemos total de páginas)
                    const pct = (paginaActual % 10) * 10;
                    document.getElementById('vm-progress-bar').style.width = `${pct}%`;

                    await esperarQuePaceTermine();
                    // Sin delay adicional — pace ya garantiza que cargó
                }
            } catch(e) {
                console.error('Error durante escaneo:', e);
                // Avisar al usuario si algo falló inesperadamente
                document.getElementById('vm-progress').innerText = `⚠️ Error en página ${paginaActual}: ${e.message}`;
                await esperar(3000);
            } finally {
                if (document.body.contains(overlay)) document.body.removeChild(overlay);
            }

            presentarResultados(filasEncontradasHTML, paginaActual, cancelado);
            cancelado = false;
        });

        // --- RESET ---
        document.getElementById('vm-btn-limpiar').addEventListener('click', async function() {
            cancelado = true;
            document.querySelector('.table-container').style.display = 'block';
            const resultadosDiv = document.getElementById('vm-resultados-totales');
            resultadosDiv.style.display = 'none';
            resultadosDiv.innerHTML = '';
            document.getElementById('vm-seriales-input').value = '';

            const btnBack = document.querySelector('i.fa-fast-backward')?.closest('button');
            if (btnBack && !btnBack.disabled) {
                btnBack.click();
                await esperarQuePaceTermine();
            }
            const btnRefresh = document.querySelector('i.fa-refresh')?.closest('button');
            if (btnRefresh) btnRefresh.click();

            cancelado = false;
        });
    }

    setTimeout(inyectarPanel, 2000);
})();

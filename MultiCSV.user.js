// ==UserScript==
// @name        Multi-ACS CSV
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/monitoring*
// @grant       none
// @run-at      document-idle
// @version     1.5
// @author      Ing. Adrian Leon
// @updateURL   https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiCSV.user.js
// @downloadURL https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiCSV.user.js
// @icon        https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function () {
  'use strict';

  // Usar arreglo preserva el orden lógico por Hub (un objeto reordena claves numéricas ascendentemente)
  const TODAS_LAS_OLTS = [
    { id: 32, name: 'MCYHUB0' },
    { id: 33, name: 'MCYHUB2' },
    { id: 34, name: 'MCYHUB3' },
    { id: 35, name: 'MCYHUB4' },
    { id: 36, name: 'MCYHUB5' },
    { id: 28, name: 'LMTHUB0' },
    { id: 31, name: 'LMTHUB2' },
    { id: 27, name: 'TURHUB0' },
    { id: 30, name: 'TURHUB2' },
    { id: 29, name: 'LAVHUB0' },
    { id: 18, name: 'PLNHUB0' },
    { id: 19, name: 'PLNHUB2' },
    { id: 78, name: 'CTVHUB0' },
    { id: 99, name: 'ARGTJR1' },
    { id: 101, name: 'ARGLMT3' },
    { id: 103, name: 'ARGLAV2' }
  ];

  const FETCH_TIMEOUT_MS = 30000;
  const DELAY_BETWEEN_OLTS_MS = 1500;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inicializarPanel() {
    if (document.getElementById('fttx-extractor-panel')) return;

    if (!document.body) {
      setTimeout(inicializarPanel, 500);
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #fttx-extractor-panel {
        position: fixed; bottom: 24px; right: 24px; width: 320px;
        background: #1e293b; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        border: 1px solid #334155; border-radius: 12px; padding: 20px;
        z-index: 999999; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        display: flex; flex-direction: column; transition: width 0.3s ease;
      }

      .fttx-header {
        display: flex; justify-content: space-between; align-items: center;
        margin: 0 0 16px 0; border-bottom: 1px solid #334155; padding-bottom: 12px;
      }
      #fttx-extractor-panel.minimized { width: 250px; }
      #fttx-extractor-panel.minimized .fttx-header { margin: 0; border-bottom: none; padding-bottom: 0; }
      .fttx-btn-min {
        background: none; border: none; color: #94a3b8; font-size: 20px;
        cursor: pointer; padding: 0 4px; line-height: 1; transition: color 0.2s;
      }
      .fttx-btn-min:hover { color: #f8fafc; }
      .fttx-content { display: flex; flex-direction: column; }
      #fttx-extractor-panel.minimized .fttx-content { display: none; }

      #fttx-extractor-panel h3 {
        margin: 0; font-size: 15px; font-weight: 600; color: #e2e8f0; letter-spacing: 0.5px;
      }
      .fttx-btn-group { display: flex; gap: 8px; margin-bottom: 12px; }
      .fttx-btn-small {
        flex: 1; background: #334155; color: #cbd5e1; border: none; padding: 6px 12px;
        cursor: pointer; border-radius: 6px; font-size: 12px; transition: background 0.2s, color 0.2s;
      }
      .fttx-btn-small:hover { background: #475569; color: #f8fafc; }

      .fttx-list {
        background: #0f172a; border: 1px solid #1e293b; border-radius: 8px;
        padding: 8px; margin-bottom: 16px; overflow-y: auto; max-height: 200px;
      }
      .fttx-list::-webkit-scrollbar { width: 6px; }
      .fttx-list::-webkit-scrollbar-track { background: transparent; }
      .fttx-list::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 10px; }

      .fttx-label {
        display: flex; align-items: center; gap: 10px; padding: 6px 8px;
        border-radius: 6px; cursor: pointer; transition: background 0.2s; font-size: 13px; color: #cbd5e1;
      }
      .fttx-label:hover { background: #1e293b; color: #f8fafc; }
      .fttx-label input[type="checkbox"] { margin: 0; cursor: pointer; accent-color: #3b82f6; }

      .fttx-switch {
        display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
        font-size: 13px; font-weight: 500; color: #cbd5e1; cursor: pointer;
      }
      .fttx-switch input[type="checkbox"] { accent-color: #3b82f6; }

      .fttx-btn-primary {
        background: #3b82f6; color: #ffffff; border: none; padding: 12px; width: 100%;
        font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 8px;
        transition: background 0.2s; letter-spacing: 0.5px;
      }
      .fttx-btn-primary:hover { background: #2563eb; }
      .fttx-btn-primary:disabled { background: #475569; color: #94a3b8; cursor: not-allowed; }

      .fttx-status {
        margin-top: 14px; font-size: 12px; color: #94a3b8; text-align: center; min-height: 15px; font-weight: 500;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'fttx-extractor-panel';

    const htmlOLTs = `
      <div class="fttx-list">
        ${TODAS_LAS_OLTS.map(({ id, name }) => `
          <label class="fttx-label">
            <input type="checkbox" class="olt-checkbox" value="${escapeHtml(id)}" data-name="${escapeHtml(name)}">
            <span>${escapeHtml(name)}</span>
          </label>
        `).join('')}
      </div>
    `;

    panel.innerHTML = `
      <div class="fttx-header">
        <h3>Extracción de Datos ACS</h3>
        <button id="fttx-btn-minimize" class="fttx-btn-min" title="Minimizar/Maximizar">&minus;</button>
      </div>
      <div class="fttx-content">
        <div class="fttx-btn-group">
          <button id="fttx-btn-select-all" class="fttx-btn-small">Seleccionar Todo</button>
          <button id="fttx-btn-select-none" class="fttx-btn-small">Limpiar</button>
        </div>
        ${htmlOLTs}
        <label class="fttx-switch">
          <input type="checkbox" id="fttx-chk-merge" checked>
          Unir todo en un archivo (Merge)
        </label>
        <button id="fttx-btn-ejecutar" class="fttx-btn-primary">INICIAR EXTRACCIÓN</button>
        <div id="fttx-status-text" class="fttx-status">Listo para operar.</div>
      </div>
    `;
    document.body.appendChild(panel);

    const btnEjecutar = panel.querySelector('#fttx-btn-ejecutar');
    const statusText = panel.querySelector('#fttx-status-text');
    const btnMinimize = panel.querySelector('#fttx-btn-minimize');

    btnMinimize.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      btnMinimize.innerHTML = panel.classList.contains('minimized') ? '&#43;' : '&minus;';
    });

    panel.querySelector('#fttx-btn-select-all').addEventListener('click', () => {
      panel.querySelectorAll('.olt-checkbox').forEach(cb => { cb.checked = true; });
    });
    panel.querySelector('#fttx-btn-select-none').addEventListener('click', () => {
      panel.querySelectorAll('.olt-checkbox').forEach(cb => { cb.checked = false; });
    });

    function actualizarStatus(mensaje, color = '#94a3b8') {
      statusText.textContent = mensaje;
      statusText.style.color = color;
    }

    function buscarTokenAutomatico() {
      // Prioridad 1: ruta estándar currentUser
      try {
        const rawUser = localStorage.getItem('currentUser');
        if (rawUser) {
          const tokenId = JSON.parse(rawUser)?.token?.id;
          if (typeof tokenId === 'string' && tokenId.length > 0) return tokenId;
        }
      } catch {}

      // Prioridad 2: escaneo por regex JWT en storages
      const regexJWT = /(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/;
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const value = storage.getItem(storage.key(i));
          if (typeof value === 'string' && value.includes('eyJ')) {
            const match = value.match(regexJWT);
            if (match) return match[0];
          }
        }
      }
      return null;
    }

    function escaparCeldaCSV(valor) {
      if (valor === null || valor === undefined) return '""';
      const str = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
      return `"${str.replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim()}"`;
    }

    function descargarComoCSV(datos, nombreArchivo) {
      if (!Array.isArray(datos) || datos.length === 0) return false;

      const filasValidas = datos.filter(
        fila => fila && typeof fila === 'object' && Object.keys(fila).length > 5 && (fila.serialNumber || fila.dbSerialNumber)
      );
      if (filasValidas.length === 0) return false;

      // Unión ordenada de todas las cabeceras para no perder columnas entre distintas OLTs
      const cabecerasSet = new Set();
      for (const fila of filasValidas) {
        for (const key of Object.keys(fila)) {
          cabecerasSet.add(key);
        }
      }
      const cabeceras = Array.from(cabecerasSet);

      const lineasCSV = [cabeceras.map(escaparCeldaCSV).join(',')];
      for (const fila of filasValidas) {
        lineasCSV.push(cabeceras.map(c => escaparCeldaCSV(fila[c])).join(','));
      }

      const blob = new Blob(['\ufeff' + lineasCSV.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nombreArchivo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      return true;
    }

    async function fetchOltDevices(url, token) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'x-access-token': token
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    }

    btnEjecutar.addEventListener('click', async () => {
      const checkboxes = Array.from(panel.querySelectorAll('.olt-checkbox:checked'));
      if (checkboxes.length === 0) {
        return actualizarStatus('Selecciona al menos una OLT.', '#ef4444');
      }

      const token = buscarTokenAutomatico();
      if (!token) {
        return actualizarStatus('Token de sesión no encontrado.', '#ef4444');
      }

      const isMerge = panel.querySelector('#fttx-chk-merge').checked;
      btnEjecutar.disabled = true;

      const chunks = [];
      let exitosas = 0;
      let fallidas = 0;
      let archivosGenerados = 0;
      let authExpirada = false;

      try {
        const filterParam = encodeURIComponent(JSON.stringify({ order: 'serialNumber ASC' }));

        for (let i = 0; i < checkboxes.length; i++) {
          const oltId = checkboxes[i].value;
          const oltName = checkboxes[i].dataset.name;
          const url = `${window.location.origin}/api/fttx/olts/${oltId}/active-devices?filter=${filterParam}`;

          actualizarStatus(`Consultando ${oltName} (${i + 1}/${checkboxes.length})...`, '#38bdf8');

          try {
            const response = await fetchOltDevices(url, token);

            if (response.status === 401 || response.status === 403) {
              authExpirada = true;
              fallidas += checkboxes.length - i;
              break;
            }

            if (response.ok) {
              const data = await response.json();
              const datosValidos = Array.isArray(data) ? data : [];

              if (isMerge) {
                chunks.push(datosValidos);
              } else {
                actualizarStatus(`Generando archivo para ${oltName}...`, '#fbbf24');
                const descargado = descargarComoCSV(datosValidos, `${oltName}.csv`);
                if (descargado) {
                  archivosGenerados++;
                } else {
                  console.warn(`Omitiendo ${oltName}, no hay datos útiles.`);
                }
              }
              exitosas++;
            } else {
              fallidas++;
              console.error(`Error en ${oltName}: HTTP ${response.status}`);
            }
          } catch (error) {
            fallidas++;
            console.error(`Error de red/timeout en ${oltName}:`, error);
          }

          if (i < checkboxes.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_OLTS_MS));
          }
        }

        if (authExpirada) {
          actualizarStatus('Sesión expirada (HTTP 401/403). Recargue el ACS e intente de nuevo.', '#ef4444');
          return;
        }

        if (isMerge) {
          actualizarStatus('Procesando archivo final...', '#fbbf24');
          const datosMergeados = chunks.flat();
          const nombreMerge = checkboxes.length === 1 ? `${checkboxes[0].dataset.name}.csv` : 'SuperMesh.csv';
          const descargado = descargarComoCSV(datosMergeados, nombreMerge);

          if (!descargado) {
            actualizarStatus(
              fallidas > 0
                ? `Sin datos válidos (${fallidas} OLT(s) fallaron).`
                : 'No se encontraron datos para generar el archivo.',
              '#fbbf24'
            );
            return;
          }
        } else if (archivosGenerados === 0) {
          actualizarStatus(
            fallidas > 0
              ? `No se generó ningún archivo (${fallidas} OLT(s) con error).`
              : 'No se encontraron datos útiles en las OLTs seleccionadas.',
            '#fbbf24'
          );
          return;
        }

        if (fallidas > 0) {
          actualizarStatus(`Completado con advertencias: ${exitosas} OK, ${fallidas} error(es).`, '#fbbf24');
        } else {
          actualizarStatus(`Extracción completada (${exitosas}/${checkboxes.length} OLTs).`, '#34d399');
        }
      } finally {
        btnEjecutar.disabled = false;
      }
    });
  }

  setTimeout(inicializarPanel, 1500);
})();

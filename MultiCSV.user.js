// ==UserScript==
// @name        Multi-ACS CSV
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/monitoring*
// @grant       none
// @version     1.2
// @author      Ing. Adrian Leon
// @updateURL   https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiCSV.user.js
// @downloadURL https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiCSV.user.js
// @icon        https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function() {
  const TODAS_LAS_OLTS = {
    32: "MCYHUB0",
    33: "MCYHUB2",
    34: "MCYHUB3",
    35: "MCYHUB4",
    36: "MCYHUB5",
    28: "LMTHUB0",
    31: "LMTHUB2",
    27: "TURHUB0",
    30: "TURHUB2",
    29: "LAVHUB0",
    18: "PLNHUB0",
    19: "PLNHUB2",
    78: "CTVHUB0",
    99: "ARGTJR1",
    101: "ARGLMT3",
    103: "ARGLAV2"
  };

  const style = document.createElement('style');
  style.textContent = `
    #fttx-extractor-panel {
      position: fixed; bottom: 24px; right: 24px; width: 320px;
      background: #1e293b; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      border: 1px solid #334155; border-radius: 12px; padding: 20px;
      z-index: 999999; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      display: flex; flex-direction: column; transition: width 0.3s ease;
    }
    
    /* --- Estilos de Cabecera y Minimizado --- */
    .fttx-header {
      display: flex; justify-content: space-between; align-items: center;
      margin: 0 0 16px 0; border-bottom: 1px solid #334155; padding-bottom: 12px;
    }
    #fttx-extractor-panel.minimized {
      width: 250px;
    }
    #fttx-extractor-panel.minimized .fttx-header {
      margin: 0; border-bottom: none; padding-bottom: 0;
    }
    .fttx-btn-min {
      background: none; border: none; color: #94a3b8; font-size: 20px;
      cursor: pointer; padding: 0 4px; line-height: 1; transition: color 0.2s;
    }
    .fttx-btn-min:hover { color: #f8fafc; }
    .fttx-content {
      display: flex; flex-direction: column;
    }
    #fttx-extractor-panel.minimized .fttx-content {
      display: none;
    }
    /* -------------------------------------- */

    #fttx-extractor-panel h3 {
      margin: 0; font-size: 15px; font-weight: 600; color: #e2e8f0; letter-spacing: 0.5px;
    }
    .fttx-btn-group {
      display: flex; gap: 8px; margin-bottom: 12px;
    }
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

  let htmlOLTs = `<div class="fttx-list">`;
  for (const [id, nombre] of Object.entries(TODAS_LAS_OLTS)) {
    htmlOLTs += `
      <label class="fttx-label">
        <input type="checkbox" class="olt-checkbox" value="${id}" data-name="${nombre}"> 
        <span>${nombre}</span>
      </label>`;
  }
  htmlOLTs += `</div>`;

  panel.innerHTML = `
    <div class="fttx-header">
      <h3>Extracción de Datos ACS</h3>
      <button id="btn-minimize" class="fttx-btn-min" title="Minimizar/Maximizar">&minus;</button>
    </div>
    <div class="fttx-content">
      <div class="fttx-btn-group">
        <button id="btn-select-all" class="fttx-btn-small">Seleccionar Todo</button>
        <button id="btn-select-none" class="fttx-btn-small">Limpiar</button>
      </div>
      ${htmlOLTs}
      <label class="fttx-switch">
        <input type="checkbox" id="chk-merge" checked> 
        Unir todo en un archivo (Merge)
      </label>
      <button id="btn-ejecutar" class="fttx-btn-primary">INICIAR EXTRACCIÓN</button>
      <div id="status-text" class="fttx-status">Listo para operar.</div>
    </div>
  `;
  document.body.appendChild(panel);

  const btnEjecutar = panel.querySelector('#btn-ejecutar');
  const statusText = panel.querySelector('#status-text');
  const btnMinimize = panel.querySelector('#btn-minimize');
  
  // --- Lógica de minimizar/maximizar ---
  btnMinimize.addEventListener('click', () => {
    panel.classList.toggle('minimized');
    if (panel.classList.contains('minimized')) {
      btnMinimize.innerHTML = '&#43;'; // Símbolo +
    } else {
      btnMinimize.innerHTML = '&minus;'; // Símbolo -
    }
  });

  panel.querySelector('#btn-select-all').addEventListener('click', () => {
    panel.querySelectorAll('.olt-checkbox').forEach(cb => cb.checked = true);
  });
  panel.querySelector('#btn-select-none').addEventListener('click', () => {
    panel.querySelectorAll('.olt-checkbox').forEach(cb => cb.checked = false);
  });

  function actualizarStatus(mensaje, color = "#94a3b8") {
    statusText.innerText = mensaje;
    statusText.style.color = color;
  }

  function buscarTokenAutomatico() {
    const storages = [localStorage, sessionStorage];
    const regexJWT = /(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/;
    for (const storage of storages) {
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

  function descargarComoCSV(datos, nombreArchivo) {
    if (!datos || datos.length === 0) return false;

    const primerObjetoValido = datos.find(fila => fila && Object.keys(fila).length > 5);
    if (!primerObjetoValido) return false;
    
    const cabeceras = Object.keys(primerObjetoValido);
    const lineasCSV = [cabeceras.join(",")];

    datos.forEach(fila => {
      if (!fila || typeof fila !== 'object' || Object.keys(fila).length === 0) return;
      if (!fila.serialNumber && !fila.dbSerialNumber) return;

      let valores = cabeceras.map(cabecera => {
        let valor = fila[cabecera];
        if (valor === null || valor === undefined) return '""';
        valor = String(valor).replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim();
        return `"${valor}"`;
      });
      lineasCSV.push(valores.join(","));
    });

    if (lineasCSV.length <= 1) return false;

    const csvContent = lineasCSV.join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", nombreArchivo);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return true;
  }

  btnEjecutar.addEventListener('click', async () => {
    const checkboxes = Array.from(panel.querySelectorAll('.olt-checkbox:checked'));
    if (checkboxes.length === 0) {
      return actualizarStatus("Selecciona al menos una OLT.", "#ef4444");
    }

    const token = buscarTokenAutomatico();
    if (!token) {
      return actualizarStatus("Token de sesión no encontrado.", "#ef4444");
    }

    const isMerge = panel.querySelector('#chk-merge').checked;
    btnEjecutar.disabled = true;
    
    let datosMergeados = [];
    let oltsProcesadas = 0;

    for (let i = 0; i < checkboxes.length; i++) {
      const oltId = checkboxes[i].value;
      const oltName = checkboxes[i].getAttribute('data-name');
      const url = `https://190.153.58.82/api/fttx/olts/${oltId}/active-devices?filter=%7B%22order%22:%22serialNumber%20ASC%22%7D`;
      
      actualizarStatus(`Consultando ${oltName} (${i + 1}/${checkboxes.length})...`, "#38bdf8");

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { "accept": "application/json, text/plain, */*", "x-access-token": token }
        });

        if (response.ok) {
          const data = await response.json();
          const datosValidos = Array.isArray(data) ? data : [];
          
          if (isMerge) {
            datosMergeados = datosMergeados.concat(datosValidos);
          } else {
            actualizarStatus(`Generando archivo para ${oltName}...`, "#fbbf24");
            const descargado = descargarComoCSV(datosValidos, `${oltName}.csv`);
            if (!descargado) console.warn(`Omitiendo ${oltName}, no hay datos útiles.`);
          }
          oltsProcesadas++;
        } else {
          console.error(`Error en ${oltName}: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error(`Error de red en ${oltName}:`, error);
      }

      if (i < checkboxes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    if (isMerge) {
      actualizarStatus(`Procesando archivo final...`, "#fbbf24");
      const nombreMerge = checkboxes.length === 1 ? `${checkboxes[0].getAttribute('data-name')}.csv` : `SuperMesh.csv`;
      const descargado = descargarComoCSV(datosMergeados, nombreMerge);
      if (!descargado) actualizarStatus("No se encontraron datos para generar el archivo.", "#fbbf24");
    }

    actualizarStatus(`Extracción completada con éxito.`, "#34d399");
    btnEjecutar.disabled = false;
  });

})();

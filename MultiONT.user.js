// ==UserScript==
// @name        Multi-Locate ONT
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/fttx/locate-ont*
// @grant       none
// @version     3
// @author      Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONT.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function() {
    'use strict';

    // Helper para extraer el token JWT de localStorage o sessionStorage
    // (Generalmente aplicaciones Angular/React guardan el token de la sesión aquí)
    function getAuthToken() {
        const keys = Object.keys(localStorage).concat(Object.keys(sessionStorage));
        for (let k of keys) {
            let val = localStorage.getItem(k) || sessionStorage.getItem(k);
            let match = val && val.match(/(eyJhbGci[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+)/);
            if (match) return match[1];
        }
        return null;
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

        let cancelado = false;

        document.getElementById('vm-btn-start').addEventListener('click', async function() {
            const inputTxt = document.getElementById('vm-seriales-input').value;
            const seriales = inputTxt.split(/[\n, ]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
            if (seriales.length === 0) return alert("No hay seriales para buscar.");

            const token = getAuthToken();
            if (!token) {
                alert("No se pudo encontrar el token de acceso. Por favor, asegúrate de haber iniciado sesión.");
                return;
            }

            cancelado = false;
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

            document.getElementById('vm-overlay-cancel').onclick = () => { cancelado = true; };

            const baseUrl = window.location.origin;
            const headers = {
                "accept": "application/json, text/plain, */*",
                "x-access-token": token
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
            const UMBRAL_BYTES = 500 * 1024 * 1024; // 500 MB en bytes

            let resultados = [];

            for (let i = 0; i < seriales.length; i++) {
                if (cancelado) break;

                const s = seriales[i];
                let exito = false;
                let fila = { serial: s, status: "ERROR/NO ENCONTRADO", consumo: "N/A", cliente: "", olt: "", rx: "", tx: "" };

                // Prevenir fetch con serial vacío que provoca error 404/500 en la API
                if (!s || s === "") {
                    resultados.push({ serial: "VACÍO", status: "SERIAL INVÁLIDO", consumo: "N/A", cliente: "", olt: "", rx: "", tx: "" });
                    continue;
                }

                for (let intento = 1; intento <= 3; intento++) {
                    if (cancelado) break;

                    document.getElementById('vm-p').innerText = `Buscando (${i + 1}/${seriales.length}): ${s}` + (intento > 1 ? ` (Reintento ${intento}/3)` : ``);
                    document.getElementById('vm-progress-bar').style.width = `${((i + 1) / seriales.length) * 100}%`;

                    try {
                        // 1. Fetch de la data de la ONT
                        const locateRes = await fetch(`${baseUrl}/api/fttx/locate-ont-by-serial-number/${s}?filter=%7B%22include%22:%7B%7D%7D`, { headers });

                        // Si el servidor responde 404, significa que la ONT no existe (no tiene sentido reintentar fallos de red aquí).
                        if (locateRes.status === 404) {
                            fila.status = "NO ENCONTRADO";
                            break;
                        }

                        if (!locateRes.ok) throw new Error("Falla en la respuesta de la API (ONT)");

                        const ontData = await locateRes.json();
                        const status = ontData.generalStatus || "Desconocido";
                        const terminalNodeId = ontData.dbTerminalNodeId;
                        const cliente = ontData.dbClientName || "";
                        const olt = ontData.requestedOlt || "";
                        const rx = ontData.rx || "";
                        const tx = ontData.tx || "";

                        let consumo = "NO";
                        // 2. Fetch del consumo
                        if (terminalNodeId) {
                            const consRes = await fetch(`${baseUrl}/api/fttx/terminal-nodes/${terminalNodeId}/consumption?filter=%7B%22order%22:%22consumptionDay%20ASC%22,%22include%22:%7B%7D%7D`, { headers });

                            if (!consRes.ok) throw new Error("Falla en la respuesta de la API (Consumos)");

                            const consData = await consRes.json();

                            const dataReciente = consData.filter(c => c.consumptionDay === strHoy || c.consumptionDay === strAyer);
                            const totalBytesRecientes = dataReciente.reduce((acc, curr) => acc + parseInt(curr.down || 0) + parseInt(curr.up || 0), 0);

                            if (totalBytesRecientes >= UMBRAL_BYTES) consumo = "SI";
                        }

                        fila = { serial: s, status, consumo, cliente, olt, rx, tx };
                        exito = true;
                        break; // Salir del loop de reintentos porque fue exitoso

                    } catch (e) {
                        console.warn(`Intento ${intento} fallido para ${s}:`, e);
                        if (intento < 3) {
                            // Esperar 2 segundos antes de reintentar
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                }

                resultados.push(fila);

                // Pausa normal entre ONTs para no ahogar al servidor (1 segundo en lugar de 200ms)
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            document.body.removeChild(overlay);

            if (resultados.length > 0) {
                // Generar el contenido del CSV
                let csvContent = "Serial,Status,Consumo,Cliente,OLT,RX,TX\n";
                resultados.forEach(row => {
                    // Escapar comillas dobles en el nombre del cliente por si acaso
                    const clienteSafe = row.cliente.replace(/"/g, '""');
                    csvContent += `${row.serial},${row.status},${row.consumo},"${clienteSafe}",${row.olt},${row.rx},${row.tx}\n`;
                });

                // Descargar el archivo
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", `Reporte_ONTs_${new Date().getTime()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        });
    }

    setTimeout(inyectarPanel, 1500);
})();

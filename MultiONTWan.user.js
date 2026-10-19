// ==UserScript==
// @name        Multi-Locate ONT - WAN Info
// @namespace   Violentmonkey Scripts
// @match       *://190.153.58.82/fttx/locate-ont*
// @grant       none
// @version     4.0
// @author      Ing. Adrian Leon
// @updateURL    https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONTWan.user.js
// @downloadURL  https://raw.githubusercontent.com/TakRiuto/ACSScripts/release/MultiONTWan.user.js
// @icon         https://avatars.githubusercontent.com/u/20828447?v=4
// ==/UserScript==

(function() {
    'use strict';

    function getAuthToken() {
        const keys = Object.keys(localStorage).concat(Object.keys(sessionStorage));
        for (let k of keys) {
            let val = localStorage.getItem(k) || sessionStorage.getItem(k);
            let match = val && val.match(/(eyJhbGci[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+)/);
            if (match) return match[1];
        }
        return null;
    }

    // Parsea la respuesta en texto plano de la OLT Huawei
    function parseWanInfo(rawText) {
        const services = {
            internet: "N/A",
            tr069: "N/A",
            voip: "N/A"
        };

        if (!rawText) return services;

        // Dividir por bloques delimitados por las líneas de guiones
        const bloques = rawText.split(/---------------------------------------------------------------------/);

        for (const bloque of bloques) {
            const serviceMatch = bloque.match(/Service type\s*:\s*([^\r\n]+)/i);
            const ipMatch = bloque.match(/IPv4 address\s*:\s*([^\r\n]+)/i);

            if (serviceMatch) {
                const tipo = serviceMatch[1].trim().toLowerCase();
                let ip = ipMatch ? ipMatch[1].trim() : "Sin IP";

                // Si la CLI muestra "-" o "0.0.0.0", se considera Sin IP
                if (ip === "-" || ip === "" || ip === "0.0.0.0") {
                    ip = "Sin IP";
                }

                if (tipo.includes("internet")) services.internet = ip;
                else if (tipo.includes("tr069")) services.tr069 = ip;
                else if (tipo.includes("voip")) services.voip = ip;
            }
        }

        return services;
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
                    <label style="font-weight:bold; font-size:14px;">Lista de Seriales para Reporte WAN/IP:</label>
                    <textarea id="vm-seriales-input" class="form-control" style="height: 100px; font-family:monospace;" placeholder="Pega los seriales aquí..."></textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:25px;">
                    <button id="vm-btn-start" class="btn btn-primary" style="font-weight:bold; min-width:180px; background:#1ab394;">Generar CSV WAN</button>
                </div>
            </div>
            <div id="vm-log" style="font-size:11px; color:#555; margin-top:5px;">Consulta estado y direcciones IP en servicios WAN para ONTs Online.</div>
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
                <h2 style="color:#1ab394;">Consultando APIs y Datos WAN...</h2>
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

            let resultados = [];

            for (let i = 0; i < seriales.length; i++) {
                if (cancelado) break;

                const s = seriales[i];
                let fila = {
                    serial: s,
                    status: "ERROR/NO ENCONTRADO",
                    cliente: "",
                    olt: "",
                    rx: "",
                    tx: "",
                    ip_internet: "N/A",
                    ip_tr069: "N/A",
                    ip_voip: "N/A"
                };

                for (let intento = 1; intento <= 3; intento++) {
                    if (cancelado) break;

                    document.getElementById('vm-p').innerText = `Procesando (${i + 1}/${seriales.length}): ${s}` + (intento > 1 ? ` (Reintento ${intento}/3)` : ``);
                    document.getElementById('vm-progress-bar').style.width = `${((i + 1) / seriales.length) * 100}%`;

                    try {
                        // 1. Localizar ONT
                        const locateRes = await fetch(`${baseUrl}/api/fttx/locate-ont-by-serial-number/${s}?filter=%7B%22include%22:%7B%7D%7D`, { headers });

                        if (locateRes.status === 404) {
                            fila.status = "NO ENCONTRADO";
                            break;
                        }

                        if (!locateRes.ok) throw new Error("Falla en la respuesta (Locate ONT)");

                        const ontData = await locateRes.json();
                        fila.status = (ontData.generalStatus || "Desconocido").toUpperCase();
                        fila.cliente = ontData.dbClientName || "";
                        fila.olt = ontData.requestedOlt || "";
                        fila.rx = ontData.rx || "";
                        fila.tx = ontData.tx || "";

                        const oltId = ontData.dbOltId || ontData.requestedOltId;

                        // 2. Si está ONLINE y conocemos la OLT, buscamos la info WAN
                        if (fila.status === "ONLINE" && oltId) {
                            document.getElementById('vm-p').innerText = `Consultando WAN (${i + 1}/${seriales.length}): ${s}...`;

                            const wanUrl = `${baseUrl}/api/fttx/olts/${oltId}/wan-info/${s}?filter=%7B%22where%22:%7B%22or%22:%5B%7B%22language%22:%22ES%22%7D,%7B%22language%22:null%7D%5D%7D%7D`;
                            const wanRes = await fetch(wanUrl, { headers });

                            if (wanRes.ok) {
                                const wanData = await wanRes.json();
                                const ips = parseWanInfo(wanData.response);
                                fila.ip_internet = ips.internet;
                                fila.ip_tr069 = ips.tr069;
                                fila.ip_voip = ips.voip;
                            } else {
                                fila.ip_internet = "Error WAN";
                                fila.ip_tr069 = "Error WAN";
                                fila.ip_voip = "Error WAN";
                            }
                        }

                        break; // Éxito, salir del loop de reintentos

                    } catch (e) {
                        console.warn(`Intento ${intento} fallido para ${s}:`, e);
                        if (intento < 3) await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                resultados.push(fila);
                // Pausa para no saturar OLTs ni API
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            document.body.removeChild(overlay);

            if (resultados.length > 0) {
                // Columnas del CSV
                let csvContent = "Serial,Status,Cliente,OLT,RX,TX,IP_Internet,IP_TR069,IP_VoIP\n";
                resultados.forEach(row => {
                    const clienteSafe = (row.cliente || "").replace(/"/g, '""');
                    csvContent += `${row.serial},${row.status},"${clienteSafe}",${row.olt},${row.rx},${row.tx},${row.ip_internet},${row.ip_tr069},${row.ip_voip}\n`;
                });

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", `Reporte_ONTs_WAN_${Date.now()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        });
    }

    setTimeout(inyectarPanel, 1500);
})();

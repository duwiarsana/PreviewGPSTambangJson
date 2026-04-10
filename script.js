/**
 * Preview GPS Tambang - Mission Control Logic
 */

// Fleet Management State
let fleet = {}; 
let activeUnitId = null;
let map, pathLine; 
let telemetryChart;
let isPlaying = false;
let isLocked = true; // Map follow state
let playInterval;
let missionTime = { start: 0, end: 0, current: 0 };

// DOM Elements
const elements = {
    sats: document.getElementById('val-sats'),
    temp: document.getElementById('val-temp'),
    tempFill: document.getElementById('temp-fill'),
    ext: document.getElementById('val-ext'),
    odo: document.getElementById('val-odo'),
    speed: document.getElementById('hud-speed'),
    speedRing: document.getElementById('speed-ring'),
    horizonPoint: document.getElementById('gsensor-point'),
    gx: document.getElementById('val-gx'),
    gy: document.getElementById('val-gy'),
    gz: document.getElementById('val-gz'),
    time: document.getElementById('nav-time'),
    date: document.getElementById('nav-date'),
    timeline: document.getElementById('timeline'),
    btnPlay: document.getElementById('btn-play'),
    iconPlay: document.querySelector('.icon-play'),
    iconPause: document.querySelector('.icon-pause'),
    indAcc: document.getElementById('ind-acc'),
    indPto: document.getElementById('ind-pto'),
    eventLog: document.getElementById('event-log-list'),
    loading: document.getElementById('loading'),
    loadFill: document.querySelector('.load-fill'),
    loadStatus: document.querySelector('.load-status'),
    dumpCount: document.getElementById('val-dump-count'),
    indBeacon: document.getElementById('ind-beacon'),
    fleetList: document.getElementById('fleet-unit-list'),
    missionId: document.querySelector('.mission-id'),
    operatorId: document.getElementById('val-operator'),
    indOperator: document.getElementById('ind-operator'),
    btnLock: document.getElementById('btn-lock'),
    lockIconOn: document.getElementById('lock-icon-on'),
    lockIconOff: document.getElementById('lock-icon-off')
};

// --- Helpers ---

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- App Initialization ---

async function initApp() {
    setupEvents();
    try {
        updateLoader(10, "REQUESTING TELEMETRY STREAMS...");
        
        let response = await fetch('gps_log.jsonl');
        if (!response.ok) {
            console.warn("gps_log.jsonl not found, trying dt_log.jsonl...");
            response = await fetch('dt_log.jsonl');
        }
        
        if (!response.ok) throw new Error("Local fetch failed (CORS or Missing Files)");
        
        const text = await response.text();
        processData(text);
    } catch (err) {
        console.warn("Auto-load failed. Waiting for manual upload.", err);
        elements.loading.classList.add('manual-mode');
        updateLoader(0, "WAITING FOR DATA SOURCE...");
        elements.loadStatus.innerText = "LOCAL FETCH BLOCKED BY CORS. PLEASE LOAD DATA MANUALLY.";
    }
}

async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    elements.loading.classList.remove('hidden', 'manual-mode');
    updateLoader(10, `LOADING ${files.length} UNIT LOGS...`);
    
    const filePromises = files.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve({ name: file.name, content: event.target.result });
            reader.readAsText(file);
        });
    });

    const results = await Promise.all(filePromises);
    processFleetData(results);
}

function processFleetData(fileResults) {
    fleet = {};
    updateLoader(30, "PARSING FLEET TELEMETRY...");
    
    let globalMin = Infinity;
    let globalMax = -Infinity;

    fileResults.forEach((res, fIdx) => {
        const lines = res.content.trim().split('\n');
        const unitData = [];
        let unitId = `UNIT-${fIdx + 1}`;
        let unitType = 'TRUCK';

        updateLoader(30 + (fIdx / fileResults.length * 30), `DECODING ${res.name}...`);

        lines.forEach(line => {
            if (!line) return;
            try {
                const j = JSON.parse(line);
                if (j.latitude && j.longitude) {
                    unitId = j.source || unitId;
                    unitType = j.record_type === 'dt' ? 'DUMP TRUCK' : 'EXCAVATOR';
                    const ts = new Date(j.timestamp).getTime();
                    // TEST EDIT
                    
                    if (ts < globalMin) globalMin = ts;
                    if (ts > globalMax) globalMax = ts;
                    
                    unitData.push({
                        ts: ts,
                        lat: j.latitude,
                        lng: j.longitude,
                        speed: Math.round(j.speed || 0),
                        sats: j.satellites || 0,
                        temp: j.mcu_temp || 0,
                        ext: (j.external / 1000).toFixed(1),
                        odo: j.odometer || 0,
                        gx: j.gsensor?.x || 0,
                        gy: j.gsensor?.y || 0,
                        gz: j.gsensor?.z || 0,
                        pto: j.input_status ? j.input_status[0] === '1' : false,
                        acc: j.ignition === 1,
                        beacon: j.ibeacon && j.ibeacon.length > 0,
                        beaconData: j.ibeacon?.[0] || null,
                        ibutton: j.ibutton || { id: "NONE", status: "none" },
                        alt: j.altitude || 0,
                        timeStr: formatTime(j.timestamp),
                        dateStr: formatDate(j.timestamp)
                    });
                }
            } catch (e) {}
        });

        if (unitData.length > 0) {
            // Sort by time
            unitData.sort((a, b) => a.ts - b.ts);
            
            // Calculate Dumping
            let dumpCycles = 0;
            let lastPto = false;
            unitData.forEach(d => {
                if (d.pto && !lastPto) dumpCycles++;
                lastPto = d.pto;
            });

            fleet[unitId] = {
                id: unitId,
                type: unitType,
                data: unitData,
                totalDumping: dumpCycles,
                marker: null,
                path: null,
                color: getUnitColor(unitId)
            };
        }
    });

    if (Object.keys(fleet).length === 0) {
        alert("CRITICAL ERROR: NO VALID TELEMETRY FOUND IN FILES");
        return;
    }

    // Set Mission Range
    missionTime.start = globalMin;
    missionTime.end = globalMax;
    missionTime.current = missionTime.start;

    updateLoader(60, "INITIALIZING FLEET VISUALS...");
    renderFleetList();
    calculateFleetStats();
    
    // Choose first unit as active
    activeUnitId = Object.keys(fleet)[0];

    // Refresh Map/Chart
    if (map) map.remove();
    initMap();
    if (telemetryChart) telemetryChart.destroy();
    initChart();
    
    updateLoader(100, "FLEET COMMAND ACTIVE");
    setTimeout(() => elements.loading.classList.add('hidden'), 800);
    
    updateStateByTime(missionTime.start);
}

function calculateFleetStats() {
    const ids = Object.keys(fleet);
    const activeUnitsEl = document.getElementById('stat-active-units');
    const totalDumpingEl = document.getElementById('stat-total-dumping');
    
    if (activeUnitsEl) activeUnitsEl.textContent = ids.length;
    
    let totalDumps = 0;
    ids.forEach(id => {
        totalDumps += fleet[id].totalDumping || 0;
    });
    if (totalDumpingEl) totalDumpingEl.textContent = totalDumps;
}

function getUnitColor(id) {
    const colors = ['#22d3ee', '#f87171', '#fbbf24', '#34d399', '#818cf8', '#a78bfa'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function renderFleetList() {
    elements.fleetList.innerHTML = '';
    Object.values(fleet).forEach(unit => {
        const el = document.createElement('div');
        el.className = `fleet-unit ${unit.id === activeUnitId ? 'active' : ''}`;
        el.innerHTML = `
            <div class="unit-info">
                <div class="unit-id" style="color: ${unit.color}">${unit.id}</div>
                <div class="unit-type">${unit.type}</div>
            </div>
            <div class="unit-dot" style="background: ${unit.color}"></div>
        `;
        el.onclick = () => selectUnit(unit.id);
        elements.fleetList.appendChild(el);
    });
}

function selectUnit(id) {
    activeUnitId = id;
    renderFleetList();
    elements.missionId.innerHTML = `${id} <small>// MISSION FOCUS</small>`;
    if (telemetryChart) telemetryChart.destroy();
    initChart();
    updateStateByTime(missionTime.current);
}

function updateStateByTime(ts) {
    missionTime.current = ts;
    
    // Update Slider
    const progress = ((ts - missionTime.start) / (missionTime.end - missionTime.start)) * 1000;
    elements.timeline.value = progress;

    Object.values(fleet).forEach(unit => {
        // Find closest index for this time
        const data = unit.data;
        let bestIdx = 0;
        let minDiff = Infinity;
        
        // Simple binary search or scan for nearest point
        // For playback, we can just keep track of last index to optimize, but simple scan is fine for now
        for (let i = 0; i < data.length; i++) {
            const diff = Math.abs(data[i].ts - ts);
            if (diff < minDiff) {
                minDiff = diff;
                bestIdx = i;
            } else if (diff > minDiff) {
                break; // Because data is sorted by time
            }
        }

        const point = data[bestIdx];
        
        // Update Marker
        if (unit.marker) {
            unit.marker.setLatLng([point.lat, point.lng]);
            const markerEl = unit.marker.getElement();
            if (markerEl) {
                // Update Label Content
                const label = markerEl.querySelector('.marker-label');
                if (label) label.innerHTML = `${unit.id}<br><small>ALT: ${point.alt}m</small>`;

                if (point.beacon) markerEl.classList.add('beacon-active');
                else markerEl.classList.remove('beacon-active');
                markerEl.style.borderColor = unit.color;
                markerEl.style.boxShadow = `0 0 15px ${unit.color}`;
            }
        }

        // If this is the focussed unit, update HUD
        if (unit.id === activeUnitId) {
            updateHUD(point);
            if (isLocked) {
                map.panTo([point.lat, point.lng], { animate: true, duration: 0.1 });
            }
        }
    });

    elements.time.innerText = formatTime(ts);
    elements.date.innerText = formatDate(ts);
}

function updateHUD(d) {
    if (!d) return;
    
    elements.sats.innerText = d.sats;
    elements.temp.innerText = d.temp + "°C";
    elements.tempFill.style.width = Math.min((d.temp - 20) / 60 * 100, 100) + "%";
    elements.ext.innerText = d.ext + "V";
    elements.odo.innerText = d.odo.toLocaleString() + " km";
    elements.speed.innerText = d.speed;
    
    // Speed Ring Logic: Max 40 km/h
    const maxSpeed = 40;
    const speedRatio = Math.min(d.speed / maxSpeed, 1);
    elements.speedRing.style.strokeDashoffset = 283 - (speedRatio * 283);
    
    // Dynamic Color Calculation
    let color = 'var(--cyan-primary)';
    if (d.speed > 30) color = 'var(--rose-crit)';
    else if (d.speed > 20) color = 'var(--amber-warn)';
    
    elements.speedRing.style.stroke = color;
    elements.speedRing.style.filter = `drop-shadow(0 0 8px ${color})`;
    
    // Artificial Horizon Rotation (using G-sensor Z/Y for Pitch/Roll)
    const horizon = document.getElementById('horizon');
    if (horizon) {
        // Multiplier adjusted for visual tilt sensitivity
        const pitch = d.gz * 20; 
        const roll = d.gy * 20;
        horizon.style.transform = `rotate(${roll}deg)`;
        const horizonFill = horizon.querySelector('.horizon-fill');
        if (horizonFill) {
            horizonFill.style.transform = `translateY(${pitch}px)`;
        }
    }

    // Numeric G-Sensor Updates
    if (elements.gx) elements.gx.innerText = d.gx;
    if (elements.gy) elements.gy.innerText = d.gy;
    if (elements.gz) elements.gz.innerText = d.gz;
    
    if (d.acc) elements.indAcc.classList.add('active'); else elements.indAcc.classList.remove('active');
    if (d.pto) elements.indPto.classList.add('active'); else elements.indPto.classList.remove('active');
    if (d.beacon) elements.indBeacon.classList.add('active'); else elements.indBeacon.classList.remove('active');
    if (elements.dumpCount) elements.dumpCount.innerText = fleet[activeUnitId].totalDumping;
    
    // Operator Sync
    if (elements.operatorId) elements.operatorId.innerText = d.ibutton.id || "NONE";
    if (elements.indOperator) {
        elements.indOperator.innerText = (d.ibutton.status || "OFFLINE").toUpperCase();
        elements.indOperator.className = "op-status-pill " + (d.ibutton.status === 'login' ? 'logged-in' : (d.ibutton.status === 'logout' ? 'logged-out' : ''));
    }

    // Ripple effect on marker
    Object.keys(fleet).forEach(id => {
        const unit = fleet[id];
        if (unit.marker) {
            const el = unit.marker.getElement();
            if (el) {
                if (id === activeUnitId) el.classList.add('marker-focused');
                else el.classList.remove('marker-focused');
            }
        }
    });

    checkEventLog(d);
}

function updateLoader(percent, status) {
    elements.loadFill.style.width = percent + "%";
    elements.loadStatus.innerText = status;
}

// --- Map Logic ---

function initMap() {
    const activeData = fleet[activeUnitId].data;
    const startPoint = [activeData[0].lat, activeData[0].lng];
    
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(startPoint, 17);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
    }).addTo(map);

    // Render Markers and Paths for each unit
    Object.values(fleet).forEach(unit => {
        const latlngs = unit.data.map(d => [d.lat, d.lng]);
        
        unit.path = L.polyline(latlngs, {
            color: unit.color,
            weight: 2,
            opacity: 0.3,
            dashArray: '5, 8'
        }).addTo(map);

        unit.marker = L.marker([unit.data[0].lat, unit.data[0].lng], {
            icon: L.divIcon({
                className: 'vehicle-marker',
                html: `<div class="marker-label">${unit.id}<br><small>ALT: ${unit.data[0].alt}m</small></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            })
        }).addTo(map);
        
        // Dynamic styling for non-active units
        const markerEl = unit.marker.getElement();
        if (markerEl) {
            markerEl.style.borderColor = unit.color;
            markerEl.style.boxShadow = `0 0 15px ${unit.color}`;
        }
    });
}

// --- Chart Logic ---

function initChart() {
    const ctx = document.getElementById('telemetryChart').getContext('2d');
    const unit = fleet[activeUnitId];
    const unitData = unit.data;
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `${unit.color}66`); // 40% opacity
    gradient.addColorStop(1, `${unit.color}00`);

    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: unitData.map((_, i) => i),
            datasets: [{
                label: 'Velocity',
                data: unitData.map(d => d.speed),
                borderColor: unit.color,
                borderWidth: 2,
                fill: true,
                backgroundColor: gradient,
                pointRadius: 0,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#475569', font: { family: 'Space Mono', size: 10 } }
                }
            }
        }
    });
}

function checkEventLog(d) {
    if (d.acc !== lastLogStatus.acc) {
        addLogEntry(`${activeUnitId}: IGNITION ${d.acc ? 'ON' : 'OFF'}`, d.acc ? 'info' : 'warn', d.timeStr, d.ts);
        lastLogStatus.acc = d.acc;
    }
    if (d.pto !== lastLogStatus.pto) {
        addLogEntry(`${activeUnitId}: DUMPING ${d.pto ? 'START' : 'END'}`, d.pto ? 'info' : 'warn', d.timeStr, d.ts);
        lastLogStatus.pto = d.pto;
    }
    if (d.beacon !== lastLogStatus.beacon) {
        if (d.beacon) {
            addLogEntry(`${activeUnitId}: BEACON DETECTED [${d.beaconData.mac}]`, 'info', d.timeStr, d.ts);
        } else {
            addLogEntry(`${activeUnitId}: BEACON LOST`, 'warn', d.timeStr, d.ts);
        }
        lastLogStatus.beacon = d.beacon;
    }
    // iButton Log
    if (d.ibutton.status !== lastLogStatus.ibuttonStatus) {
        if (d.ibutton.status === 'login') {
            addLogEntry(`${activeUnitId}: OPERATOR [${d.ibutton.id}] LOGGED IN`, 'info', d.timeStr, d.ts);
        } else if (d.ibutton.status === 'logout') {
            addLogEntry(`${activeUnitId}: OPERATOR [${d.ibutton.id}] LOGGED OUT`, 'warn', d.timeStr, d.ts);
        }
        lastLogStatus.ibuttonStatus = d.ibutton.status;
    }
}

let lastLogStatus = { acc: null, pto: null, beacon: null, ibuttonStatus: null };

function addLogEntry(msg, type, time, timestamp) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<div class="time">${time}</div><div class="msg">${msg}</div>`;
    
    // Time Travel
    if (timestamp) {
        entry.onclick = () => {
            missionTime.current = timestamp;
            updateStateByTime(timestamp);
            isLocked = true;
            elements.btnLock.classList.add('active');
            elements.lockIconOn.style.display = 'block';
            elements.lockIconOff.style.display = 'none';
        };
    }

    elements.eventLog.prepend(entry);
    if (elements.eventLog.children.length > 50) elements.eventLog.lastChild.remove();
}

// --- Player Logic ---

function togglePlay() {
    isPlaying = !isPlaying;
    if (isPlaying) {
        elements.iconPlay.style.display = 'none';
        elements.iconPause.style.display = 'block';
        playInterval = setInterval(() => {
            if (missionTime.current >= missionTime.end) {
                togglePlay();
                return;
            }
            // Step forward by 5 seconds for smoother sweep
            missionTime.current += 5000; 
            updateStateByTime(missionTime.current);
        }, 100);
    } else {
        elements.iconPlay.style.display = 'block';
        elements.iconPause.style.display = 'none';
        clearInterval(playInterval);
    }
}

function setupEvents() {
    if (elements.btnPlay) elements.btnPlay.onclick = togglePlay;
    
    if (elements.btnLock) {
        elements.btnLock.onclick = () => {
            isLocked = !isLocked;
            elements.btnLock.classList.toggle('active', isLocked);
            elements.lockIconOn.style.display = isLocked ? 'block' : 'none';
            elements.lockIconOff.style.display = isLocked ? 'none' : 'block';
            if (isLocked) {
                const activeData = fleet[activeUnitId].data;
                // Find point closest to current mission time to snap back
                updateStateByTime(missionTime.current);
            }
        };
        // Initialize state
        elements.btnLock.classList.add('active');
    }

    if (elements.timeline) {
        elements.timeline.max = 1000;
        elements.timeline.oninput = (e) => {
            const pct = parseInt(e.target.value) / 1000;
            const ts = missionTime.start + (missionTime.end - missionTime.start) * pct;
            updateStateByTime(ts);
        };
    }
    
    const btnUpload = document.getElementById('btn-upload');
    const btnManualLoad = document.getElementById('btn-manual-load');
    const fileInput = document.getElementById('file-input');
    
    if (btnUpload && fileInput) btnUpload.onclick = () => fileInput.click();
    if (btnManualLoad && fileInput) btnManualLoad.onclick = () => fileInput.click();
    if (fileInput) fileInput.onchange = handleFileUpload;
}

window.onload = initApp;

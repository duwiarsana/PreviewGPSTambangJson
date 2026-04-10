# Preview GPS Tambang - Mission Control

A high-performance, web-based fleet monitoring dashboard designed for mining operations. This system provides a "Mission Control" style interface for tracking multiple Dump Trucks (DT) and Excavators (EXCA) simultaneously with real-time telemetry visualization.

## 🚀 Key Features

- **Multi-Vehicle Fleet Synchronization**: Load multiple `.jsonl` log files and monitor the entire fleet on a single map.
- **Temporal Alignment**: All vehicles are synchronized via timestamp. Scrape the global timeline to see exactly where each vehicle was at any given moment.
- **Hardware Telemetry HUD**:
  - **Dynamic Speedometer**: Re-scaled for precision (0-40 km/h) with color-coded safety zones (Cyan/Safe, Amber/Warning, Red/Danger).
  - **Machine Health**: Monitor MCU Temperature, External Voltage, and Satellite count.
  - **G-Sensor View**: 3-axis accelerometer visualization for terrain and driving analysis.
- **Operator Tracking (iButton)**: Monitor which operator is logged into which vehicle, including real-time login/logout status and session audit logs.
- **Map Focus Control**:
  - **Lock Map Mode**: Automatically follows the active vehicle.
  - **Free Pan Mode**: Manually inspect specific areas without losing sync.
  - **Vehicle Annotations**: Permanent on-map labels showing Unit ID and current Altitude.
- **Operational Analytics**: Automatic calculation of "Dumping Cycles" based on PTO status.

## 📊 Data Format (JSONL)

The system parses line-delimited JSON files. Each line represents a telemetry pulse from a unit.

### Example Log Entry
```json
{
  "source": "DT01",
  "timestamp": "2026-04-08T10:35:46Z",
  "latitude": -0.738727,
  "longitude": 117.131224,
  "altitude": 52,
  "speed": 15,
  "mcu_temp": 58.7,
  "external": 25219,
  "ignition": 1,
  "input_status": "100000",
  "ibutton": { "id": "010A0D09", "status": "login", "auth": true },
  "gsensor": { "x": 8, "y": 4, "z": 991 }
}
```

### Field Breakdown
| Field | Description |
| :--- | :--- |
| `source` | Unique identifier for the vehicle (e.g., DT01, EXCA01). |
| `timestamp` | ISO 8601 formatted time of the record. |
| `latitude` / `longitude` | GPS coordinates for map positioning. |
| `altitude` | Vertical elevation in meters. |
| `speed` | Current velocity in km/h. |
| `ignition` | Engine status (1: ON, 0: OFF). |
| `input_status` | Binary string (Bit 0: PTO/Dumping status). |
| `ibutton` | Operator authentication and status (id, login/logout). |
| `gsensor` | X, Y, Z raw accelerometer data for orientation. |

## 🛠️ Installation & Usage

1. **Open `index.html`** in any modern web browser.
2. Click **"LOAD DATA"** or **"SELECT FILES"** in the top navigation.
3. Select one or more `.jsonl` files from your local storage.
4. Use the **Fleet Sidebar** on the left to switch focus between different vehicles.
5. Use the **Play/Pause** and **Timeline** controls at the bottom to replay the mission.

---
*Built with Leaflet.js, Chart.js, and Vanilla Modern CSS/JS.*

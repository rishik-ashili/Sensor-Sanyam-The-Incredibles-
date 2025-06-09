import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import json
import time
import random
from datetime import datetime
import sys
import socket

# API Configuration
API_ENDPOINT = "http://localhost:9003/api/sensor-data"
MAX_RETRIES = 5
RETRY_DELAY = 2  # seconds

def check_server_availability():
    """Check if the Next.js server is running and accessible."""
    try:
        # Try to connect to the server
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(('localhost', 9003))
        sock.close()
        
        if result == 0:
            return True
        return False
    except:
        return False

def wait_for_server():
    """Wait for the server to become available."""
    print("[INFO] Checking server availability...")
    for i in range(MAX_RETRIES):
        if check_server_availability():
            print("[INFO] Server is available!")
            return True
        print(f"[INFO] Server not available, retrying in {RETRY_DELAY} seconds... (Attempt {i+1}/{MAX_RETRIES})")
        time.sleep(RETRY_DELAY)
    return False

# Configure retry strategy
retry_strategy = Retry(
    total=3,  # number of retries
    backoff_factor=1,  # wait 1, 2, 4 seconds between retries
    status_forcelist=[500, 502, 503, 504]  # HTTP status codes to retry on
)
adapter = HTTPAdapter(max_retries=retry_strategy)
session = requests.Session()
session.mount("http://", adapter)
session.mount("https://", adapter)

# Add global enabled flag and scale
enabled = True
scale = 1.0

# Sensor configurations
sensors = [
    {
        "name": "temperature3",
        "min": 18,
        "max": 32,
        "unit": "°C",
        "threshold": 25
    },
    {
        "name": "humidity3",
        "min": 35,
        "max": 75,
        "unit": "%",
        "threshold": 55
    },
    {
        "name": "pressure3",
        "min": 960,
        "max": 1040,
        "unit": "hPa",
        "threshold": 1000
    },
    {
        "name": "light3",
        "min": 0,
        "max": 1200,
        "unit": "lux",
        "threshold": 600
    },
    {
        "name": "co23",
        "min": 350,
        "max": 2500,
        "unit": "ppm",
        "threshold": 1200
    }
]

# Initialize current values for random walk
current_values = [random.uniform(sensor["min"], sensor["max"]) for sensor in sensors]
# Initialize per-sensor energy (monotonically increasing)
energy_values = [0.0 for _ in sensors]

def send_sensor_data(sensor_index: int, value: float, energy: float):
    """Send sensor data to the API endpoint with retry logic."""
    try:
        sensor = sensors[sensor_index]
        payload = {
            "sensorName": sensor["name"],
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": "rpi3",
            "coordinates": {"lat": 19.0760, "lon": 72.8777},  # Mumbai coordinates
            "threshold": sensor["threshold"],
            "energy": round(energy, 2)
        }
        
        print(f"[DEBUG] Attempting to send data for {sensor['name']}: {payload}")
        
        response = session.post(API_ENDPOINT, json=payload, timeout=5)
        response.raise_for_status()
        
        result = response.json()
        if result.get('success'):
            print(f"[SUCCESS] Data published for {sensor['name']}: {payload}")
        else:
            print(f"[WARNING] API returned non-success response: {result}")
            
    except requests.exceptions.ConnectionError as e:
        print(f"[ERROR] Connection failed: {e}")
        print("[INFO] Make sure the Next.js server is running on port 9003")
        if not wait_for_server():
            print("[FATAL] Could not connect to server after multiple retries")
            sys.exit(1)
    except requests.exceptions.Timeout as e:
        print(f"[ERROR] Request timed out: {e}")
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Request failed: {e}")
        if hasattr(e.response, 'text'):
            print(f"[ERROR] Response: {e.response.text}")
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")

def main():
    # Check server availability before starting
    if not wait_for_server():
        print("[FATAL] Could not connect to server. Please make sure the Next.js server is running.")
        sys.exit(1)

    print("\n[STARTUP] Beginning initial burst publish...")
    try:
        for _ in range(5):
            for i, sensor in enumerate(sensors):
                value = current_values[i] * scale
                energy_values[i] += random.uniform(0.1, 1.0) * scale
                send_sensor_data(i, value, energy_values[i])
            time.sleep(0.2)  # 200ms between bursts
        print("[STARTUP] Initial burst publish complete.\n")

        while True:
            if enabled:
                for i, sensor in enumerate(sensors):
                    # Update sensor value using random walk
                    delta = random.uniform(-0.5, 0.5)
                    current_values[i] = min(max(current_values[i] + delta, sensor["min"]), sensor["max"])
                    value = current_values[i] * scale
                    
                    # Update energy value
                    energy_values[i] += random.uniform(0.1, 1.0) * scale
                    
                    # Send data to API
                    send_sensor_data(i, value, energy_values[i])
                    
                time.sleep(2)  # 2 second interval between updates
            else:
                time.sleep(0.2)  # Sleep briefly while paused

    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Stopping publisher...")
    except Exception as e:
        print(f"\n[FATAL] Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import json
import time
import random
from datetime import datetime
import sys
import socket
import urllib3
import base64
import argparse

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Default Configuration
DEFAULT_CONFIG = {
    "api_endpoint": "http://localhost:9003/api/sensor-data",  # Change this to your deployed API URL
    "username": "sensorflow",
    "password": "sensorflow123",
    "device_id": "rpi3",  # Change this to identify your device
    "location": {
        "lat": 19.0760,
        "lon": 72.8777
    }
}

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description='MQTT Publisher for Sensor Data')
    parser.add_argument('--api', help='API endpoint URL', default=DEFAULT_CONFIG["api_endpoint"])
    parser.add_argument('--username', help='API username', default=DEFAULT_CONFIG["username"])
    parser.add_argument('--password', help='API password', default=DEFAULT_CONFIG["password"])
    parser.add_argument('--device', help='Device ID', default=DEFAULT_CONFIG["device_id"])
    parser.add_argument('--lat', type=float, help='Device latitude', default=DEFAULT_CONFIG["location"]["lat"])
    parser.add_argument('--lon', type=float, help='Device longitude', default=DEFAULT_CONFIG["location"]["lon"])
    return parser.parse_args()

# Get configuration from command line arguments
args = parse_arguments()

# API Configuration
API_ENDPOINT = args.api
API_USERNAME = args.username
API_PASSWORD = args.password
DEVICE_ID = args.device
DEVICE_LOCATION = {"lat": args.lat, "lon": args.lon}

MAX_RETRIES = 10
RETRY_DELAY = 2  # seconds

def get_auth_header():
    """Generate Basic Auth header."""
    credentials = f"{API_USERNAME}:{API_PASSWORD}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Basic {encoded}"

def check_server_availability():
    """Check if the API server is running and accessible."""
    try:
        response = requests.get(API_ENDPOINT, 
                              headers={"Authorization": get_auth_header()},
                              timeout=2,
                              verify=False)
        return response.status_code < 500
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
    total=5,
    backoff_factor=1,
    status_forcelist=[500, 502, 503, 504],
    allowed_methods=["POST", "GET"]
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

ALPHA = 0.1  # Smoothing factor for exponential smoothing

def send_sensor_data(sensor_index: int, value: float, energy: float):
    """Send sensor data to the API endpoint with retry logic."""
    try:
        sensor = sensors[sensor_index]
        payload = {
            "sensorName": sensor["name"],
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": DEVICE_ID,
            "coordinates": DEVICE_LOCATION,
            "threshold": sensor["threshold"],
            "energy": round(energy, 2)
        }
        
        print(f"[DEBUG] Attempting to send data for {sensor['name']}: {payload}")
        
        headers = {
            "Authorization": get_auth_header(),
            "Content-Type": "application/json"
        }
        
        response = session.post(API_ENDPOINT, 
                              json=payload, 
                              headers=headers,
                              timeout=5, 
                              verify=False)
        response.raise_for_status()
        
        result = response.json()
        if result.get('success'):
            print(f"[SUCCESS] Data published for {sensor['name']}: {payload}")
        else:
            print(f"[WARNING] API returned non-success response: {result}")
            
    except requests.exceptions.ConnectionError as e:
        print(f"[ERROR] Connection failed: {e}")
        print("[INFO] Make sure the API server is running and accessible")
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
    print(f"\n[CONFIG] Using API endpoint: {API_ENDPOINT}")
    print(f"[CONFIG] Device ID: {DEVICE_ID}")
    print(f"[CONFIG] Location: {DEVICE_LOCATION}\n")

    # Check server availability before starting
    if not wait_for_server():
        print("[FATAL] Could not connect to server. Please make sure the API server is running and accessible.")
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
                    # Exponential smoothing for realistic sensor data
                    new_random = random.uniform(sensor["min"], sensor["max"])
                    current_values[i] = ALPHA * new_random + (1 - ALPHA) * current_values[i]
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
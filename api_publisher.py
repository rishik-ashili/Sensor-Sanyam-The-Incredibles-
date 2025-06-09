import requests
import json
import time
import random
from datetime import datetime

# API Configuration
API_BASE_URL = "http://localhost:3001/api"
DEVICE_ID = "rpi3"

# Sensor configurations
sensors = [
    {
        "name": "temperature",
        "min": 20,
        "max": 30,
        "unit": "°C",
        "threshold": 25
    },
    {
        "name": "humidity",
        "min": 40,
        "max": 60,
        "unit": "%",
        "threshold": 50
    },
    {
        "name": "pressure",
        "min": 980,
        "max": 1020,
        "unit": "hPa",
        "threshold": 1000
    },
    {
        "name": "light",
        "min": 0,
        "max": 1000,
        "unit": "lux",
        "threshold": 500
    },
    {
        "name": "co2",
        "min": 400,
        "max": 2000,
        "unit": "ppm",
        "threshold": 1000
    }
]

# Initialize current values for random walk
current_values = [random.uniform(sensor["min"], sensor["max"]) for sensor in sensors]
# Initialize per-sensor energy (monotonically increasing)
energy_values = [0.0 for _ in sensors]

# Global enabled flag and scale
enabled = True
scale = 1.0

def send_sensor_data(sensor, value, energy_value):
    """Send sensor data to the API."""
    try:
        # Send main sensor data
        sensor_payload = {
            "device": DEVICE_ID,
            "sensor": sensor["name"],
            "value": round(value, 2),
            "unit": sensor["unit"],
            "timestamp": datetime.utcnow().isoformat(),
            "coordinates": {"lat": 13.0827, "lon": 80.2707},  # Chennai coordinates
            "threshold": sensor["threshold"]
        }
        
        response = requests.post(f"{API_BASE_URL}/sensor-data", json=sensor_payload)
        if response.status_code != 200:
            print(f"Error sending sensor data: {response.text}")
        
        # Send energy data
        energy_payload = {
            "device": DEVICE_ID,
            "sensor": f"{sensor['name']}/energy",
            "value": round(energy_value, 2),
            "unit": "kWh",
            "timestamp": datetime.utcnow().isoformat(),
            "coordinates": {"lat": 13.0827, "lon": 80.2707}
        }
        
        response = requests.post(f"{API_BASE_URL}/sensor-data", json=energy_payload)
        if response.status_code != 200:
            print(f"Error sending energy data: {response.text}")
            
    except Exception as e:
        print(f"Error sending data: {e}")

def check_device_state():
    """Check if device is enabled and get scale factor."""
    try:
        response = requests.get(f"{API_BASE_URL}/device/{DEVICE_ID}/state")
        if response.status_code == 200:
            state = response.json()
            global enabled, scale
            enabled = state.get('enabled', True)
            scale = state.get('scale', 1.0)
    except Exception as e:
        print(f"Error checking device state: {e}")

# Burst publish on startup
print("\n[STARTUP] Beginning initial burst publish...")
for _ in range(5):
    for i, sensor in enumerate(sensors):
        value = current_values[i] * scale
        energy_values[i] += random.uniform(0.1, 1.0) * scale
        send_sensor_data(sensor, value, energy_values[i])
    time.sleep(0.2)
print("[STARTUP] Initial burst publish complete.\n")

try:
    while True:
        check_device_state()
        
        if enabled:
            for i, sensor in enumerate(sensors):
                # Update sensor value
                delta = random.uniform(-0.5, 0.5)
                current_values[i] = min(max(current_values[i] + delta, sensor["min"]), sensor["max"])
                value = current_values[i] * scale
                
                # Update energy value
                energy_values[i] += random.uniform(0.1, 1.0) * scale
                
                # Send data
                send_sensor_data(sensor, value, energy_values[i])
            
            time.sleep(1.5)  # Send data every 1.5 seconds
        else:
            time.sleep(0.2)  # Check state more frequently when disabled

except KeyboardInterrupt:
    print("\nStopping API publisher...") 
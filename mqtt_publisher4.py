import paho.mqtt.client as mqtt
import json
import time
import random
from datetime import datetime
from Crypto.Cipher import AES
import base64

# ========== CONFIGURATION ==========
MQTT_BROKER = "mqtt://localhost:1883"  # <-- Change this to your broker URL
MQTT_HOST = "broker.hivemq.com"
# MQTT_HOST = "localhost"
MQTT_PORT = 1883
BASE_TOPIC = "sensorflow/demo"
DEVICE_NAME = "rpi4"

ENCRYPTION_KEY = b'12345678901234567890123456789012'  # 32 bytes
IV = b'1234567890123456'  # 16 bytes

def encrypt_data(data):
    json_data = json.dumps(data).encode('utf-8')
    cipher = AES.new(ENCRYPTION_KEY, AES.MODE_CBC, IV)
    # Pad to 16 bytes
    pad_len = 16 - len(json_data) % 16
    padded = json_data + bytes([pad_len] * pad_len)
    encrypted = cipher.encrypt(padded)
    return base64.b64encode(encrypted).decode('utf-8')

sensors = [
    {"name": "temperature4", "min": 18, "max": 32, "unit": "°C", "threshold": 25},
    {"name": "humidity4", "min": 35, "max": 75, "unit": "%", "threshold": 55},
    {"name": "pressure4", "min": 960, "max": 1040, "unit": "hPa", "threshold": 1000},
    {"name": "light4", "min": 0, "max": 1200, "unit": "lux", "threshold": 600},
    {"name": "co24", "min": 350, "max": 2500, "unit": "ppm", "threshold": 1200}
]

current_values = [random.uniform(s["min"], s["max"]) for s in sensors]
energy_values = [0.0 for _ in sensors]

def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] Connected with result code {rc}")

client = mqtt.Client()
client.on_connect = on_connect
client.connect(MQTT_HOST, MQTT_PORT, 60)
client.loop_start()

print("\n[STARTUP] Beginning initial burst publish...")
for _ in range(5):
    for i, sensor in enumerate(sensors):
        value = current_values[i]
        payload = {
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": DEVICE_NAME,
            "coordinates": {"lat": 19.0760, "lon": 72.8777},
            "threshold": sensor["threshold"]
        }
        encrypted_payload = encrypt_data(payload)
        topic = f"{BASE_TOPIC}/{sensor['name']}"
        client.publish(topic, encrypted_payload)
        energy_values[i] += random.uniform(0.1, 1.0)
        energy_payload = {
            "value": round(energy_values[i], 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": "kWh",
            "device": DEVICE_NAME,
            "coordinates": {"lat": 19.0760, "lon": 72.8777}
        }
        encrypted_energy_payload = encrypt_data(energy_payload)
        energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
        client.publish(energy_topic, encrypted_energy_payload)
    time.sleep(0.2)
print("[STARTUP] Initial burst publish complete.\n")

try:
    while True:
        for i, sensor in enumerate(sensors):
            delta = random.uniform(-0.5, 0.5)
            current_values[i] = min(max(current_values[i] + delta, sensor["min"]), sensor["max"])
            value = current_values[i]
            payload = {
                "value": round(value, 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": sensor["unit"],
                "device": DEVICE_NAME,
                "coordinates": {"lat": 19.0760, "lon": 72.8777},
                "threshold": sensor["threshold"]
            }
            encrypted_payload = encrypt_data(payload)
            topic = f"{BASE_TOPIC}/{sensor['name']}"
            client.publish(topic, encrypted_payload)
            energy_values[i] += random.uniform(0.1, 1.0)
            energy_payload = {
                "value": round(energy_values[i], 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": "kWh",
                "device": DEVICE_NAME,
                "coordinates": {"lat": 19.0760, "lon": 72.8777}
            }
            encrypted_energy_payload = encrypt_data(energy_payload)
            energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
            client.publish(energy_topic, encrypted_energy_payload)
        time.sleep(2)
except KeyboardInterrupt:
    print("\n[SHUTDOWN] Stopping publisher...")
    client.loop_stop()
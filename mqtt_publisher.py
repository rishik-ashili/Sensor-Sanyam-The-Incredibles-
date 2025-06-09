import paho.mqtt.client as mqtt
import json
import time
import random
from datetime import datetime
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import base64

# MQTT Configuration
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
BASE_TOPIC = "sensorflow/demo"

# Encryption Configuration
ENCRYPTION_KEY = b'12345678901234567890123456789012'  # Exactly 32 bytes for AES-256
IV = b'1234567890123456'  # Exactly 16 bytes for AES

def encrypt_data(data: dict) -> str:
    """Encrypt the sensor data using AES-256-CBC."""
    try:
        # Convert dict to JSON string
        json_data = json.dumps(data)
        # Convert to bytes
        data_bytes = json_data.encode('utf-8')
        # Create cipher
        cipher = AES.new(ENCRYPTION_KEY, AES.MODE_CBC, IV)
        # Pad and encrypt
        padded_data = pad(data_bytes, AES.block_size)
        encrypted_data = cipher.encrypt(padded_data)
        # Convert to base64 for MQTT transmission
        return base64.b64encode(encrypted_data).decode('utf-8')
    except Exception as e:
        print(f"Encryption error: {e}")
        return None

# Create MQTT client
client = mqtt.Client()

# Add global enabled flag and scale
enabled = True
scale = 1.0

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")

def on_publish(client, userdata, mid):
    """Callback when a message is published."""
    print(f"[PUBLISH] Message {mid} published successfully")

def on_control(client, userdata, msg):
    global enabled, scale
    try:
        payload = json.loads(msg.payload.decode())
        if 'enabled' in payload:
            enabled = bool(payload['enabled'])
            print(f"[CONTROL] Publishing {'enabled' if enabled else 'disabled'} via control topic.")
        if 'scale' in payload:
            scale = float(payload['scale'])
            print(f"[CONTROL] Scale set to {scale}")
    except Exception as e:
        print(f"[CONTROL] Error parsing control message: {e}")

# Connect to broker
client.on_connect = on_connect
client.on_publish = on_publish
client.connect(MQTT_BROKER, MQTT_PORT, 60)

# Start the network loop
client.loop_start()

# Sensor configurations
sensors = [
    {
        "name": "temperature",
        "min": 20,
        "max": 30,
        "unit": "°C",
        "threshold": 25  # Threshold value
    },
    {
        "name": "humidity",
        "min": 40,
        "max": 60,
        "unit": "%",
        "threshold": 50  # Threshold value
    },
    {
        "name": "pressure",
        "min": 980,
        "max": 1020,
        "unit": "hPa",
        "threshold": 1000  # Threshold value
    }
]

# Initialize current values for random walk
current_values = [random.uniform(sensor["min"], sensor["max"]) for sensor in sensors]
# Initialize per-sensor energy (monotonically increasing)
energy_values = [0.0 for _ in sensors]

# Burst publish on startup to quickly populate backend buffer
print("\n[STARTUP] Beginning initial burst publish...")
for _ in range(5):
    for i, sensor in enumerate(sensors):
        # Prepare sensor value payload
        value = current_values[i] * scale
        payload = {
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": "rpi1",
            "coordinates": {"lat": 12.9716, "lon": 77.5946},
            "threshold": sensor["threshold"]
        }
        # Encrypt the payload
        encrypted_payload = encrypt_data(payload)
        if encrypted_payload:
        topic = f"{BASE_TOPIC}/{sensor['name']}"
            print(f"[PUBLISH] Sending to {topic}: {payload}")
            print(f"[ENCRYPTED] {encrypted_payload}")
            client.publish(topic, encrypted_payload)
            
            # Prepare and encrypt energy payload
            energy_values[i] += random.uniform(0.1, 1.0) * scale
        energy_payload = {
            "value": round(energy_values[i], 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": "kWh",
            "device": "rpi1",
            "coordinates": {"lat": 12.9716, "lon": 77.5946}
        }
            encrypted_energy_payload = encrypt_data(energy_payload)
            if encrypted_energy_payload:
        energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
                print(f"[PUBLISH] Sending to {energy_topic}: {energy_payload}")
                print(f"[ENCRYPTED] {encrypted_energy_payload}")
                client.publish(energy_topic, encrypted_energy_payload)
    time.sleep(0.2)  # 200ms between bursts
print("[STARTUP] Initial burst publish complete.\n")

# Subscribe to control topic
control_topic = f"{BASE_TOPIC}/rpi1/control"
client.subscribe(control_topic)
client.message_callback_add(control_topic, on_control)

try:
    while True:
        if enabled:
        for i, sensor in enumerate(sensors):
            # Update sensor value
            delta = random.uniform(-0.5, 0.5)
            current_values[i] = min(max(current_values[i] + delta, sensor["min"]), sensor["max"])
                value = current_values[i] * scale
                
                # Prepare and encrypt sensor payload
            payload = {
                "value": round(value, 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": sensor["unit"],
                "device": "rpi1",
                    "coordinates": {"lat": 12.9716, "lon": 77.5946},
                    "threshold": sensor["threshold"]
            }
                encrypted_payload = encrypt_data(payload)
                if encrypted_payload:
            topic = f"{BASE_TOPIC}/{sensor['name']}"
                    print(f"[PUBLISH] Sending to {topic}: {payload}")
                    print(f"[ENCRYPTED] {encrypted_payload}")
                    client.publish(topic, encrypted_payload)
                
                # Prepare and encrypt energy payload
                energy_values[i] += random.uniform(0.1, 1.0) * scale
            energy_payload = {
                "value": round(energy_values[i], 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": "kWh",
                "device": "rpi1",
                "coordinates": {"lat": 12.9716, "lon": 77.5946}
            }
                encrypted_energy_payload = encrypt_data(energy_payload)
                if encrypted_energy_payload:
            energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
                    print(f"[PUBLISH] Sending to {energy_topic}: {energy_payload}")
                    print(f"[ENCRYPTED] {encrypted_energy_payload}")
                    client.publish(energy_topic, encrypted_energy_payload)
        time.sleep(1)
        else:
            time.sleep(0.2)  # Sleep briefly while paused

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
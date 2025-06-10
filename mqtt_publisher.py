import paho.mqtt.client as mqtt
import json
import time
import random
from datetime import datetime
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import base64
import numpy as np

# MQTT Configuration
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
BASE_TOPIC = "sensorflow/demo"

# Encryption Configuration
ENCRYPTION_KEY = b'12345678901234567890123456789012'  # Exactly 32 bytes for AES-256
IV = b'1234567890123456'  # Exactly 16 bytes for AES

def encrypt_data(data: dict) -> str:
    """Encrypt the sensor data using AES-256-CBC with PKCS7 padding, matching Node.js/CryptoJS."""
    try:
        # Use compact JSON (no spaces)
        json_data = json.dumps(data, separators=(',', ':'))
        data_bytes = json_data.encode('utf-8')
        cipher = AES.new(ENCRYPTION_KEY, AES.MODE_CBC, IV)
        padded_data = pad(data_bytes, AES.block_size, style='pkcs7')
        encrypted_data = cipher.encrypt(padded_data)
        return base64.b64encode(encrypted_data).decode('utf-8')
    except Exception as e:
        print(f"Encryption error: {e}")
        return None

# Create MQTT client with a unique client ID
client = mqtt.Client(client_id=f"rpi1_publisher_{random.randint(0, 1000)}")

# Add global enabled flag and scale
enabled = True
scale = 1.0

def on_connect(client, userdata, flags, rc):
    print(f"[CONNECT] Connected with result code {rc}")
    if rc == 0:
        print("[CONNECT] Successfully connected to MQTT broker")
        # Resubscribe to control topic on reconnect
        control_topic = f"{BASE_TOPIC}/rpi1/control"
        client.subscribe(control_topic)
        print(f"[CONNECT] Subscribed to control topic: {control_topic}")
    else:
        print(f"[CONNECT] Failed to connect, return code {rc}")

def on_disconnect(client, userdata, rc):
    print(f"[DISCONNECT] Disconnected with result code {rc}")
    if rc != 0:
        print("[DISCONNECT] Unexpected disconnection. Attempting to reconnect...")

def on_publish(client, userdata, mid):
    """Callback when a message is published."""
    print(f"[PUBLISH] Message {mid} published successfully")

def on_control(client, userdata, msg):
    global enabled, scale
    try:
        print(f"[CONTROL] Received control message: {msg.payload.decode()}")
        payload = json.loads(msg.payload.decode())
        if 'enabled' in payload:
            enabled = bool(payload['enabled'])
            print(f"[CONTROL] Publishing {'enabled' if enabled else 'disabled'} via control topic.")
        if 'scale' in payload:
            old_scale = scale
            scale = float(payload['scale'])
            print(f"[CONTROL] Scale changed from {old_scale} to {scale}")
    except json.JSONDecodeError as e:
        print(f"[CONTROL] Error decoding JSON: {e}")
    except Exception as e:
        print(f"[CONTROL] Error processing control message: {e}")

# Set up callbacks
client.on_connect = on_connect
client.on_disconnect = on_disconnect
client.on_publish = on_publish

# Connect to broker with clean session
print("[STARTUP] Connecting to MQTT broker...")
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
print(f"[STARTUP] Subscribed to control topic: {control_topic}")

# Improved smoothing configuration
ALPHA = 0.05  # Reduced smoothing factor for more gradual changes
WINDOW_SIZE = 5  # Number of previous values to consider
value_history = [[] for _ in sensors]  # Store history for each sensor

def get_smoothed_value(sensor_index: int, new_value: float) -> float:
    """Get a smoothed value using weighted moving average."""
    history = value_history[sensor_index]
    history.append(new_value)
    if len(history) > WINDOW_SIZE:
        history.pop(0)
    
    # Use weighted moving average with more weight on recent values
    weights = np.linspace(0.5, 1.0, len(history))
    weights = weights / np.sum(weights)
    return float(np.average(history, weights=weights))

try:
    while True:
        if enabled:
            for i, sensor in enumerate(sensors):
                # Generate new random value
                new_random = random.uniform(sensor["min"], sensor["max"])
                
                # Apply exponential smoothing
                smoothed = ALPHA * new_random + (1 - ALPHA) * current_values[i]
                
                # Apply additional smoothing using weighted moving average
                current_values[i] = get_smoothed_value(i, smoothed)
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
            time.sleep(1.5)
        else:
            time.sleep(0.2)  # Sleep briefly while paused

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
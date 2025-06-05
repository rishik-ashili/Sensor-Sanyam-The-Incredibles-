import paho.mqtt.client as mqtt
import json
import time
import random
from datetime import datetime

# MQTT Configuration
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
BASE_TOPIC = "sensorflow/demo"

# Create MQTT client
client = mqtt.Client()

# Add global enabled flag
enabled = True

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")

def on_control(client, userdata, msg):
    global enabled
    try:
        payload = json.loads(msg.payload.decode())
        if 'enabled' in payload:
            enabled = bool(payload['enabled'])
            print(f"[CONTROL] Publishing {'enabled' if enabled else 'disabled'} via control topic.")
    except Exception as e:
        print(f"[CONTROL] Error parsing control message: {e}")

# Connect to broker
client.on_connect = on_connect
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
for _ in range(5):
    for i, sensor in enumerate(sensors):
        # Publish sensor value
        value = current_values[i]
        payload = {
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": "rpi1",
            "coordinates": {"lat": 12.9716, "lon": 77.5946},
            "threshold": sensor["threshold"]  # Add threshold to payload
        }
        topic = f"{BASE_TOPIC}/{sensor['name']}"
        client.publish(topic, json.dumps(payload))
        # Publish per-sensor energy value
        energy_values[i] += random.uniform(0.1, 1.0)
        energy_payload = {
            "value": round(energy_values[i], 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": "kWh",
            "device": "rpi1",
            "coordinates": {"lat": 12.9716, "lon": 77.5946}
        }
        energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
        client.publish(energy_topic, json.dumps(energy_payload))
    time.sleep(0.2)  # 200ms between bursts

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
                value = current_values[i]
                payload = {
                    "value": round(value, 2),
                    "timestamp": datetime.utcnow().isoformat(),
                    "unit": sensor["unit"],
                    "device": "rpi1",
                    "coordinates": {"lat": 12.9716, "lon": 77.5946},
                    "threshold": sensor["threshold"]  # Add threshold to payload
                }
                topic = f"{BASE_TOPIC}/{sensor['name']}"
                client.publish(topic, json.dumps(payload))
                # Update and publish per-sensor energy value
                energy_values[i] += random.uniform(0.1, 1.0)
                energy_payload = {
                    "value": round(energy_values[i], 2),
                    "timestamp": datetime.utcnow().isoformat(),
                    "unit": "kWh",
                    "device": "rpi1",
                    "coordinates": {"lat": 12.9716, "lon": 77.5946}
                }
                energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
                client.publish(energy_topic, json.dumps(energy_payload))
                print(f"Published to {topic}: {payload}")
                print(f"Published to {energy_topic}: {energy_payload}")
            # Wait for 1 second before next update
            time.sleep(1)
        else:
            time.sleep(0.2)  # Sleep briefly while paused

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
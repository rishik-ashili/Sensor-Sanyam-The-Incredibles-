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

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")

# Connect to broker
client.on_connect = on_connect
client.connect(MQTT_BROKER, MQTT_PORT, 60)

# Start the network loop
client.loop_start()

# Sensor configurations - different ranges and types
sensors = [
    {
        "name": "temperature2",  # Different name to distinguish from first publisher
        "min": 15,
        "max": 35,
        "unit": "°C"
    },
    {
        "name": "humidity2",
        "min": 30,
        "max": 80,
        "unit": "%"
    },
    {
        "name": "pressure2",
        "min": 950,
        "max": 1050,
        "unit": "hPa"
    },
    {
        "name": "light",
        "min": 0,
        "max": 1000,
        "unit": "lux"
    },
    {
        "name": "co2",
        "min": 400,
        "max": 2000,
        "unit": "ppm"
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
            "device": "rpi2",
            "coordinates": {"lat": 28.7041, "lon": 77.1025}
        }
        topic = f"{BASE_TOPIC}/{sensor['name']}"
        client.publish(topic, json.dumps(payload))
        # Publish per-sensor energy value
        energy_values[i] += random.uniform(0.1, 1.0)
        energy_payload = {
            "value": round(energy_values[i], 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": "kWh",
            "device": "rpi2",
            "coordinates": {"lat": 28.7041, "lon": 77.1025}
        }
        energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
        client.publish(energy_topic, json.dumps(energy_payload))
    time.sleep(0.2)  # 200ms between bursts

try:
    while True:
        for i, sensor in enumerate(sensors):
            # Update sensor value
            delta = random.uniform(-0.5, 0.5)
            current_values[i] = min(max(current_values[i] + delta, sensor["min"]), sensor["max"])
            value = current_values[i]
            payload = {
                "value": round(value, 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": sensor["unit"],
                "device": "rpi2",
                "coordinates": {"lat": 28.7041, "lon": 77.1025}
            }
            topic = f"{BASE_TOPIC}/{sensor['name']}"
            client.publish(topic, json.dumps(payload))
            # Update and publish per-sensor energy value
            energy_values[i] += random.uniform(0.1, 1.0)
            energy_payload = {
                "value": round(energy_values[i], 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": "kWh",
                "device": "rpi2",
                "coordinates": {"lat": 28.7041, "lon": 77.1025}
            }
            energy_topic = f"{BASE_TOPIC}/{sensor['name']}/energy"
            client.publish(energy_topic, json.dumps(energy_payload))
            print(f"Published to {topic}: {payload}")
            print(f"Published to {energy_topic}: {energy_payload}")
        # Wait for 1.5 seconds before next update (slightly different from first publisher)
        time.sleep(1.5)

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
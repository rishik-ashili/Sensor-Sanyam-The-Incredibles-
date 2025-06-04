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

# Burst publish on startup to quickly populate backend buffer
for _ in range(5):
    for sensor in sensors:
        value = random.uniform(sensor["min"], sensor["max"])
        payload = {
            "value": round(value, 2),
            "timestamp": datetime.utcnow().isoformat(),
            "unit": sensor["unit"],
            "device": "rpi2",
            "coordinates": {"lat": 28.7041, "lon": 77.1025}
        }
        topic = f"{BASE_TOPIC}/{sensor['name']}"
        client.publish(topic, json.dumps(payload))
    time.sleep(0.2)  # 200ms between bursts

try:
    while True:
        for sensor in sensors:
            # Generate random value within range
            value = random.uniform(sensor["min"], sensor["max"])
            
            # Create payload
            payload = {
                "value": round(value, 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": sensor["unit"],
                "device": "rpi2",
                "coordinates": {"lat": 28.7041, "lon": 77.1025}
            }
            
            # Publish to topic
            topic = f"{BASE_TOPIC}/{sensor['name']}"
            client.publish(topic, json.dumps(payload))
            print(f"Published to {topic}: {payload}")
            
        # Wait for 1.5 seconds before next update (slightly different from first publisher)
        time.sleep(1.5)

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
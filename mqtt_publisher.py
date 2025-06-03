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

# Sensor configurations
sensors = [
    {
        "name": "temperature",
        "min": 20,
        "max": 30,
        "unit": "°C"
    },
    {
        "name": "humidity",
        "min": 40,
        "max": 60,
        "unit": "%"
    },
    {
        "name": "pressure",
        "min": 980,
        "max": 1020,
        "unit": "hPa"
    }
]

try:
    while True:
        for sensor in sensors:
            # Generate random value within range
            value = random.uniform(sensor["min"], sensor["max"])
            
            # Create payload
            payload = {
                "value": round(value, 2),
                "timestamp": datetime.utcnow().isoformat(),
                "unit": sensor["unit"]
            }
            
            # Publish to topic
            topic = f"{BASE_TOPIC}/{sensor['name']}"
            client.publish(topic, json.dumps(payload))
            print(f"Published to {topic}: {payload}")
            
        # Wait for 1 second before next update
        time.sleep(1)

except KeyboardInterrupt:
    print("\nStopping MQTT publisher...")
    client.loop_stop()
    client.disconnect() 
# Industrial IoT Dashboard API Documentation

This document provides detailed information about integrating with the Industrial IoT Dashboard API.

## System Architecture

### Components
1. **Frontend Dashboard**
   - React.js with Next.js
   - Real-time data visualization
   - Interactive controls
   - Responsive design

2. **Backend Services**
   - MQTT broker for real-time data
   - REST API for configuration
   - WebSocket for live updates
   - Authentication service

3. **Data Flow**
   - IoT devices → MQTT → Dashboard
   - Dashboard → MQTT → IoT devices
   - Historical data storage
   - Real-time analytics

## Local Development Integration

### Prerequisites
- Python 3.8 or higher
- Required Python packages (install via `pip install -r requirements.txt`)
- Local instance of the dashboard running on port 9003
- MQTT broker (local or remote)

### Local Integration Steps

1. **Configure the Publisher**
   Edit `mqtt_publisher3.py`:
   ```python
   # Set the domain to localhost for local development
   DOMAIN = "http://localhost:9003"
   
   # Configure sensors
   sensors = [
       {
           "name": "temperature",
           "min": 18,
           "max": 32,
           "unit": "°C",
           "threshold": 25
       },
       # Add more sensors as needed
   ]
   ```

2. **Run the Publisher**
   ```bash
   python mqtt_publisher3.py
   ```

3. **Verify Integration**
   - Check the dashboard at `http://localhost:9003`
   - Data should appear in real-time
   - Verify charts and graphs are updating
   - Check energy consumption tracking

## Online Deployment Integration

### Prerequisites
- Hosted instance of the dashboard
- Valid domain name
- SSL certificate (recommended)
- MQTT broker access

### Online Integration Steps

1. **Configure the Publisher**
   Edit `mqtt_publisher3.py`:
   ```python
   # Set the domain to your hosted instance
   DOMAIN = "https://your-domain.com"
   
   # Configure authentication
   API_KEY = "your-api-key"
   ```

2. **Update Environment Variables**
   ```python
   # Add any required API keys or authentication
   API_KEY = "your-api-key"
   MQTT_BROKER = "your-mqtt-broker"
   MQTT_PORT = 1883
   ```

3. **Run the Publisher**
   ```bash
   python mqtt_publisher3.py
   ```

## API Endpoints

### MQTT Data Endpoints

1. **Publish Sensor Data**
   ```
   POST /api/mqtt/publish
   Content-Type: application/json
   
   {
     "topic": "sensor/data",
     "payload": {
       "value": 25.5,
       "timestamp": "2024-02-20T10:00:00Z",
       "unit": "°C",
       "device": "machine1",
       "coordinates": {"lat": 12.9716, "lon": 77.5946},
       "threshold": 25,
       "energy": 150.5
     }
   }
   ```

2. **Subscribe to Topics**
   ```
   GET /api/mqtt/subscribe
   Query Parameters:
   - topic: string (required)
   - device: string (optional)
   ```

### Energy Monitoring Endpoints

1. **Get Energy Consumption**
   ```
   GET /api/energy/consumption
   Query Parameters:
   - device: string (required)
   - startDate: string (optional)
   - endDate: string (optional)
   ```

2. **Set Energy Alerts**
   ```
   POST /api/energy/alerts
   Content-Type: application/json
   
   {
     "device": "machine1",
     "threshold": 1000,
     "unit": "kWh",
     "action": "notify"
   }
   ```

### Device Control Endpoints

1. **Enable/Disable Device**
   ```
   POST /api/device/control
   Content-Type: application/json
   
   {
     "device": "machine1",
     "action": "enable",
     "scale": 1.0
   }
   ```

2. **Get Device Status**
   ```
   GET /api/device/status
   Query Parameters:
   - device: string (required)
   ```

### Authentication Endpoints

1. **Login**
   ```
   POST /api/auth/login
   Content-Type: application/json
   
   {
     "username": "user",
     "password": "pass"
   }
   ```

2. **Register**
   ```
   POST /api/auth/register
   Content-Type: application/json
   
   {
     "username": "newuser",
     "password": "newpass",
     "email": "user@example.com",
     "role": "operator"
   }
   ```

## Data Formats

### Sensor Data Format
```json
{
  "value": number,
  "timestamp": string (ISO 8601),
  "unit": string,
  "device": string,
  "coordinates": {
    "lat": number,
    "lon": number
  },
  "threshold": number,
  "energy": number
}
```

### Energy Data Format
```json
{
  "value": number,
  "timestamp": string (ISO 8601),
  "unit": "kWh",
  "device": string,
  "coordinates": {
    "lat": number,
    "lon": number
  }
}
```

## Error Handling

### Common Error Codes
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

### Error Response Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  }
}
```

## Best Practices

1. **Security**
   - Always use HTTPS for online deployments
   - Implement proper authentication
   - Use environment variables for sensitive data
   - Encrypt MQTT payloads

2. **Performance**
   - Implement rate limiting
   - Use connection pooling
   - Optimize payload size
   - Cache frequently accessed data

3. **Monitoring**
   - Implement logging
   - Monitor API usage
   - Set up alerts for errors
   - Track energy consumption

## Troubleshooting

### Common Issues

1. **Connection Issues**
   - Verify network connectivity
   - Check firewall settings
   - Validate domain configuration
   - Check MQTT broker status

2. **Authentication Failures**
   - Verify credentials
   - Check token expiration
   - Validate API key
   - Check user permissions

3. **Data Not Updating**
   - Check MQTT connection
   - Verify topic names
   - Validate payload format
   - Check device status

4. **Energy Monitoring Issues**
   - Verify energy data format
   - Check device configuration
   - Validate energy thresholds
   - Monitor data flow

## Support

For additional support:
1. Check the documentation
2. Review error logs
3. Contact the development team
4. Check system status 
# API Integration Documentation

This document provides detailed information about integrating with the MQTT Dashboard API.

## Local Development Integration

### Prerequisites
- Python 3.8 or higher
- Required Python packages (install via `pip install -r requirements.txt`)
- Local instance of the dashboard running on port 9003

### Local Integration Steps

1. **Configure the Publisher**
   Edit `mqtt_publisher3.py`:
   ```python
   # Set the domain to localhost for local development
   DOMAIN = "http://localhost:9003"
   ```
   


2. **Run the Publisher**
   ```bash
   python mqtt_publisher3.py
   ```

3. **Verify Integration**
   - Check the dashboard at `http://localhost:9003`
   - Data should appear in real-time
   - Verify charts and graphs are updating

## Online Deployment Integration

### Prerequisites
- Hosted instance of the dashboard
- Valid domain name
- SSL certificate (recommended)

### Online Integration Steps

1. **Configure the Publisher**
   Edit `mqtt_publisher3.py`:
   ```python
   # Set the domain to your hosted instance
   DOMAIN = "https://your-domain.com"
   ```

2. **Update Environment Variables**
   ```python
   # Add any required API keys or authentication
   API_KEY = "your-api-key"
   ```

3. **Run the Publisher**
   ```bash
   python mqtt_publisher3.py
   ```

## API Endpoints

### MQTT Data Endpoints

1. **Publish Data**
   ```
   POST /api/mqtt/publish
   Content-Type: application/json
   
   {
     "topic": "sensor/data",
     "payload": {
       "temperature": 25.5,
       "humidity": 60
     }
   }
   ```

2. **Subscribe to Topics**
   ```
   GET /api/mqtt/subscribe
   Query Parameters:
   - topic: string (required)
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
     "email": "user@example.com"
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

2. **Performance**
   - Implement rate limiting
   - Use connection pooling
   - Optimize payload size

3. **Monitoring**
   - Implement logging
   - Monitor API usage
   - Set up alerts for errors

## Troubleshooting

### Common Issues

1. **Connection Issues**
   - Verify network connectivity
   - Check firewall settings
   - Validate domain configuration

2. **Authentication Failures**
   - Verify credentials
   - Check token expiration
   - Validate API key

3. **Data Not Updating**
   - Check MQTT connection
   - Verify topic names
   - Validate payload format

## Support

For additional support:
1. Check the documentation
2. Review error logs
3. Contact the development team 
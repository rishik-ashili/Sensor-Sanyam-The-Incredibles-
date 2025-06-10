# MQTT Dashboard

A real-time monitoring dashboard for MQTT devices with advanced features including threshold alerts, data visualization, and responsive design.

## Features

### Real-time Monitoring
- Live data streaming from MQTT devices
- Real-time updates for temperature, humidity, and other sensor data
- Interactive charts and graphs
- Customizable dashboard layout

### Alert System
- Configurable threshold alerts
- Visual alerts (screen turns red when thresholds are exceeded)
- Customizable alert conditions
- Real-time notification system

### Authentication
- Secure user authentication
- Admin and user roles
- Protected routes and features
- Session management

### Data Visualization
- Line charts for historical data
- Bar charts for comparative analysis
- Real-time data updates
- Customizable time ranges
- Export functionality (PDF)

### Responsive Design
- Mobile-first approach
- Adaptive layouts for phones, tablets, and desktops
- Touch-friendly interface
- Responsive charts and tables

### Custom MQTT Integration
- Support for custom MQTT brokers
- Easy broker configuration
- Secure connection handling
- Multiple device support

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mqtt-dashboard
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Install Node.js dependencies:
```bash
npm install
```

4. Set up environment variables:
Create a `.env` file in the root directory with the following variables:
```
NEXT_PUBLIC_API_URL=http://localhost:9003
GOOGLE_API_KEY=your_gemini_api_key
```

5. Build and start the application:
```bash
npm run build
npm start
```

## Usage

### Starting the Application

1. Start the MQTT publishers:
```bash
python mqtt_publisher.py
python mqtt_publisher2.py
```

2. Access the dashboard at `http://localhost:9003`

### Authentication

- Admin Login:
  - Username: admin123
  - Password: admin@123

- User Registration:
  - Click "Sign Up" to create a new user account
  - Follow the registration process

### Custom MQTT Integration

1. Go to Settings
2. Add your MQTT broker details
3. Run the custom publisher:
```bash
python mqtt_publisher4.py
```

### API Integration

#### Local Development
1. Edit `mqtt_publisher3.py`
2. Set the domain to `localhost:9003`
3. Run the publisher:
```bash
python mqtt_publisher3.py
```

#### Online Deployment
1. Host your application
2. Update the domain in `mqtt_publisher3.py` to your hosted domain
3. Run the publisher to see values online

## Alert System

The current alert system implements visual alerts by turning the screen red when thresholds are exceeded. This can be customized by:

1. Modifying the alert conditions in the dashboard
2. Implementing custom alert actions
3. Adding new notification methods

## Responsive Design

The dashboard is fully responsive and works on:
- Mobile phones
- Tablets
- Desktop computers

The layout automatically adjusts based on screen size and device type.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

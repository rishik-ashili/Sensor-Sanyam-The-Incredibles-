# Sensor Sanyam
![logo](https://github.com/user-attachments/assets/7f052e05-05e1-4090-ade5-d6db49aef16e)

A comprehensive real-time monitoring dashboard for industrial IoT devices with advanced features for machine status monitoring, energy consumption tracking, and environmental parameter management.

## Demo Video
[![Watch the video](https://img.youtube.com/vi/dg13FC4ospw/hqdefault.jpg)](https://youtu.be/dg13FC4ospw)

## Screenshots
![WhatsApp Image 2025-06-10 at 23 52 11_bb24931b](https://github.com/user-attachments/assets/55855b18-b658-454f-afb9-022e61949d2a)
![WhatsApp Image 2025-06-10 at 23 52 31_120e0eed](https://github.com/user-attachments/assets/729ea773-40f5-4aa0-b316-d519777b807f)
![WhatsApp Image 2025-06-10 at 23 54 13_0aa486c4](https://github.com/user-attachments/assets/8c0871cf-b6cc-48aa-9893-34e627ed4c96)


## Novel Features

### 1. AI-Powered Sensor Insights
- **Gemini AI Integration**: Advanced AI analysis of sensor data
- **Automated Problem Detection**: Identifies sensor anomalies and issues
- **Intelligent Recommendations**: Provides actionable solutions for detected problems
- **Real-time Analysis**: Continuous monitoring and instant insights

### 2. Interactive Location Mapping
- **Real-time Device Tracking**: Visual representation of all connected devices
- **Location-based Analytics**: Monitor device distribution across locations
- **Device Density Visualization**: Heat maps showing device concentration
- **Interactive Map Features**:
  - Click to view device details
  - Filter devices by type/status
  - Real-time location updates
  - Customizable view options

### 3. Advanced Report Generation
- **Customizable Export Options**:
  - Select individual or multiple sensors
  - Choose specific graphs or all visualizations
  - Export format selection (PDF/CSV)
  - Data granularity options
- **Flexible Data Selection**:
  - Raw sensor values
  - Processed/analyzed data
  - Custom date ranges
  - Specific metrics
- **Report Customization**:
  - Add/remove sections
  - Custom headers and footers
  - Branding options
  - Multiple export formats

## Features

### Real-time Monitoring
- Real-time machine status monitoring
- Energy consumption tracking per device and sensor
- Environmental parameter monitoring (temperature, humidity, pressure, CO2, light)
- Location-based device tracking
- Historical data analysis and trending

### Real-time Data Visualization
- Live data streaming from multiple IoT devices
- Interactive charts and graphs with customizable time ranges
- Energy consumption visualization with bar charts
- Threshold monitoring with visual alerts
- Device status indicators

### Remote Device Control
- Device enable/disable controls
- Scale adjustment for sensor readings
- Real-time control commands through MQTT
- Device-specific settings management

### Customization and Flexibility
- Drag-and-drop dashboard layout
- Configurable widgets and charts
- Multiple theme options (normal, dark, blue)
- Responsive design for all screen sizes
- Customizable data views and time ranges

### Alerts and Automation
- Configurable threshold alerts
- Visual alerts (screen turns red when thresholds are exceeded)
- Real-time notifications
- Customizable alert conditions
- Energy consumption alerts

### Security and Multi-User Support
- Secure user authentication
- Role-based access control (Admin/User)
- End-to-end encrypted data communications
- Secure MQTT broker integration
- Session management

## Installation

## Installation

1. Create and activate a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
```

2. Clone the repository:

```bash
git clone https://github.com/rishik-ashili/Sensor-Sanyam-The-Incredibles-.git
cd Sensor-Sanyam-The-Incredibles-
```

3. Install Python dependencies:

```bash
pip install -r requirements.txt
```

4. Install Node.js dependencies:

```bash
npm install

npm install @genkit-ai/googleai
npm install --save-dev @types/genkit
npm install genkit
npm install @google/genai node-fetch
```

5. Set up environment variables:
   Create a `.env` file in the root directory with the following variables:

```
NEXT_PUBLIC_API_URL=http://localhost:9003
GOOGLE_API_KEY=your_gemini_api_key
```

6. Build and start the application:

```bash
npm run build
npm start
```

7. If the application does not work locally, try running it on GitHub Codespaces:

* Open the repository on GitHub.
* Press the `.` (dot) key to open the repository in Codespaces.
* Once the environment loads, follow the same installation steps as above.
* Run the same commands to start the application.



## Usage

### Starting the Application

1. Start the MQTT publishers:
```bash
python mqtt_publisher.py  # Main industrial sensors
python mqtt_publisher2.py # Additional sensors
```

2. Access the dashboard at `http://localhost:9003`

### Authentication

- Admin Login:
  - Username: admin123
  - Password: admin@123

- User Registration:
  - Click "Sign Up" to create a new user account
  - Follow the registration process

### Industrial Monitoring Features

1. **Machine Status Monitoring**
   - View real-time status of all connected devices
   - Monitor device connectivity
   - Track device locations
   - Enable/disable devices remotely

2. **Energy Consumption Tracking**
   - Monitor energy usage per device
   - Track energy consumption per sensor
   - View historical energy data
   - Set energy consumption alerts

3. **Environmental Monitoring**
   - Temperature monitoring
   - Humidity tracking
   - Pressure monitoring
   - CO2 levels
   - Light intensity
   - Custom threshold settings

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
4. Setting up energy consumption alerts

## Responsive Design

The dashboard is fully responsive and works on:
- Mobile phones
- Tablets
- Desktop computers

The layout automatically adjusts based on screen size and device type.



## System Architecture
![architecture](https://github.com/user-attachments/assets/1dd04723-0ad8-4ed2-9e57-be198f52a380)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

# MQTT Real-Time Sensor Dashboard

This project is a Next.js-based dashboard for real-time monitoring and visualization of sensor data using MQTT and Socket.IO.

## Features

- **Real-Time Data**: Ingests sensor data from an MQTT broker and delivers live updates to the frontend via Socket.IO.
- **Historical Trends**: Maintains an in-memory history of sensor readings for trend analysis.
- **Data Visualization**: Uses Chart.js (via react-chartjs-2) to display sensor data in interactive charts and tables.
- **Responsive UI**: Built with React and modern UI libraries for a sleek and responsive user experience.
- **Extensible**: Easy to add new sensors, topics, or visualizations.

## Tech Stack

- **Frontend**: Next.js, React, Chart.js, react-chartjs-2, Radix UI, lucide-react
- **Backend**: Node.js (Next.js API routes), MQTT, Socket.IO

## How It Works

1. **MQTT Integration**:  
   The backend connects to an MQTT broker (default: `mqtt://broker.hivemq.com`), subscribing to sensor topics.
2. **Data Handling**:  
   Incoming sensor messages are parsed, stored in an in-memory map, and recent history is maintained for each sensor.
3. **Real-Time Updates**:  
   New sensor data is emitted to frontend clients using Socket.IO for real-time updates.
4. **Frontend Dashboard**:  
   The React/Next.js frontend connects via Socket.IO, displays sensor status, and visualizes data in charts and tables.

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
git clone https://github.com/rishik-ashili/mqtt.git
cd mqtt
npm install
```

### Running the App

```bash
# Start the development server
npm run dev
```

The app will be available at http://localhost:3000

### Configuration

You can set the following environment variables in a `.env.local` file:

```
MQTT_BROKER_URL=mqtt://broker.hivemq.com
MQTT_BASE_TOPIC=sensorflow/demo/#
```

### File Structure

- `/src/app/page.tsx` - Main dashboard page (frontend)
- `/src/pages/api/socketio.ts` - Socket.IO and MQTT backend handler
- `/src/components/ui/` - UI components (cards, tables, charts, etc.)

## Customization

- Add new MQTT topics in the backend as needed.
- Extend the frontend UI for new sensor types or visualizations.
- Integrate authentication/authorization as necessary.

## License

[MIT](LICENSE)

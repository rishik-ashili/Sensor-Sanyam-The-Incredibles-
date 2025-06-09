"use client";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeviceConfig {
  name: string;
  broker: string;
  connectionType: 'custom-mqtt';
}

export default function SensorConfigForm() {
  const [deviceName, setDeviceName] = useState('');
  const [broker, setBroker] = useState('');
  const [devices, setDevices] = useState<DeviceConfig[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('customDevices');
    if (saved) setDevices(JSON.parse(saved));
  }, []);

  const saveDevices = (newDevices: DeviceConfig[]) => {
    setDevices(newDevices);
    localStorage.setItem('customDevices', JSON.stringify(newDevices));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim() || !broker.trim()) return;
    const newDevice: DeviceConfig = { name: deviceName.trim(), broker: broker.trim(), connectionType: 'custom-mqtt' };
    const updated = [...devices, newDevice];
    saveDevices(updated);
    setDeviceName('');
    setBroker('');
    // Optionally, notify backend to start proxy (future step)
    fetch('/api/custom-mqtt-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDevice),
    });
  };

  const handleRemove = async (name: string) => {
    const updated = devices.filter(d => d.name !== name);
    saveDevices(updated);

    // Remove from localStorage
    const savedDevices = JSON.parse(localStorage.getItem('savedDevices') || '[]');
    localStorage.setItem('savedDevices', JSON.stringify(savedDevices.filter((d: string) => d !== name)));

    // Remove any stored layouts for this device
    const layouts = JSON.parse(localStorage.getItem('sensorGridLayoutByDevice') || '{}');
    delete layouts[name];
    localStorage.setItem('sensorGridLayoutByDevice', JSON.stringify(layouts));

    // Notify backend to stop MQTT proxy
    await fetch('/api/custom-mqtt-proxy', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    // Dispatch storage event so dashboard updates in same tab
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'customDevices',
        newValue: JSON.stringify(updated)
      }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Sensor Configuration</CardTitle>
        <CardDescription>
          Manage your Raspberry Pi devices and their sensors. Add, edit, and remove configurations below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-lg font-medium font-headline">Add New Device</h3>
          <p className="text-sm text-muted-foreground">
            Add a new Raspberry Pi device, specify MQTT broker, and define sensor types.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleAdd}>
          <div>
            <Label htmlFor="deviceName">Device Name</Label>
            <Input id="deviceName" placeholder="e.g., Living Room Pi" value={deviceName} onChange={e => setDeviceName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="mqttBroker">MQTT Broker URL</Label>
            <Input id="mqttBroker" placeholder="e.g., mqtt://localhost:1883" value={broker} onChange={e => setBroker(e.target.value)} required />
          </div>
          <Button type="submit">Save Configuration</Button>
        </form>
        <div className="space-y-2">
          <h3 className="text-lg font-medium font-headline">Configured Devices</h3>
          <p className="text-sm text-muted-foreground">
            A list of currently configured devices will appear here.
          </p>
          <div className="border rounded-md p-4 bg-muted/50">
            {devices.length === 0 ? (
              <p className="text-muted-foreground">No devices configured yet.</p>
            ) : (
              <ul className="space-y-2">
                {devices.map(d => (
                  <li key={d.name} className="flex items-center justify-between">
                    <span>{d.name} <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Custom MQTT</span></span>
                    <Button size="sm" variant="destructive" onClick={() => handleRemove(d.name)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

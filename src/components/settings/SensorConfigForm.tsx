import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SensorConfigForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Sensor Configuration</CardTitle>
        <CardDescription>
          Manage your Raspberry Pi devices and their sensors. Future functionality will allow adding, editing, and removing configurations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-lg font-medium font-headline">Add New Device</h3>
          <p className="text-sm text-muted-foreground">
            This section will contain a form to add new Raspberry Pi devices, specify MQTT topics, and define sensor types.
          </p>
        </div>
        
        <form className="space-y-4">
          <div>
            <Label htmlFor="deviceName">Device Name</Label>
            <Input id="deviceName" placeholder="e.g., Living Room Pi" disabled />
          </div>
          <div>
            <Label htmlFor="mqttBroker">MQTT Broker URL</Label>
            <Input id="mqttBroker" placeholder="e.g., mqtt://localhost:1883" disabled />
          </div>
          <Button type="submit" disabled>Save Configuration (Coming Soon)</Button>
        </form>

        <div className="space-y-2">
           <h3 className="text-lg font-medium font-headline">Configured Devices</h3>
           <p className="text-sm text-muted-foreground">
            A list of currently configured devices will appear here.
           </p>
           <div className="border rounded-md p-4 bg-muted/50">
             <p className="text-muted-foreground">No devices configured yet.</p>
           </div>
        </div>
      </CardContent>
    </Card>
  );
}

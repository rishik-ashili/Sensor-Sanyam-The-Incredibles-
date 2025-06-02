import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConnectionStatusIndicator from "@/components/dashboard/ConnectionStatusIndicator";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-headline font-semibold">Dashboard</h1>
        <ConnectionStatusIndicator />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline">Latest Sensor Data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Sensor readings will appear here.</p>
            {/* Placeholder for multiple sensor cards */}
            <div className="mt-4 space-y-2">
              <div className="p-3 bg-secondary/50 rounded-md">
                <p className="font-medium">Temperature</p>
                <p className="text-2xl font-bold">-- °C</p>
              </div>
              <div className="p-3 bg-secondary/50 rounded-md">
                <p className="font-medium">Humidity</p>
                <p className="text-2xl font-bold">-- %</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Sensor Data Graphs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Interactive graphs will be displayed here.</p>
            <div className="mt-4 h-64 bg-secondary/50 rounded-md flex items-center justify-center">
              <p className="text-muted-foreground">Graph Area</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

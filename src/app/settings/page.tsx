import SensorConfigForm from '@/components/settings/SensorConfigForm';

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-headline font-semibold">Settings</h1>
      <SensorConfigForm />
    </div>
  );
}

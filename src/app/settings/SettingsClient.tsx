"use client";

import { useAuth } from '../AuthContext';
import SensorConfigForm from '@/components/settings/SensorConfigForm';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SettingsClient() {
    const { role } = useAuth();
    const isAdmin = role === 'admin';

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-headline font-semibold">Settings</h1>
            {isAdmin ? (
                <SensorConfigForm />
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="font-headline">Access Restricted</CardTitle>
                        <CardDescription>
                            Device management is restricted to administrator users only.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Please contact your administrator if you need to make changes to device configurations.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
} 
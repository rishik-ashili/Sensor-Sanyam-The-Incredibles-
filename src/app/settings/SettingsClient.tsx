"use client";

import { useAuth } from '../AuthContext';
import SensorConfigForm from '@/components/settings/SensorConfigForm';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SettingsClient() {
    const { role } = useAuth();
    const isAdmin = role === 'admin';

    return (
        <div className="space-y-8 w-full max-w-md mx-auto px-2 sm:px-0">
            <h1 className="text-3xl font-headline font-semibold text-center">Settings</h1>
            {isAdmin ? (
                <SensorConfigForm />
            ) : (
                <Card className="w-full">
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
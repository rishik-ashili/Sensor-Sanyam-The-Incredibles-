"use client";

import { AuthProvider } from './AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import { Toaster } from "@/components/ui/toaster";

export default function ClientLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AuthProvider>
            <AppLayout>
                {children}
            </AppLayout>
            <Toaster />
        </AuthProvider>
    );
} 
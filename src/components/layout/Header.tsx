"use client";

import Link from 'next/link';
import { MountainIcon, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConnectionStatusIndicator from '@/components/dashboard/ConnectionStatusIndicator';
import { useAuth } from '@/app/AuthContext';
import React, { useState } from 'react';

export default function Header() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="bg-card shadow-sm sticky top-0 z-40 border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-primary hover:text-primary/90 transition-colors">
          <MountainIcon className="h-6 w-6" />
          <span className="text-xl font-semibold font-headline">SensorFlow Dashboard</span>
        </Link>
        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-4">
          <Button variant="ghost" asChild>
            <Link href="/">Dashboard</Link>
          </Button>
          {isAdmin && (
            <Button variant="ghost" asChild>
              <Link href="/settings">Settings</Link>
            </Button>
          )}
          <ConnectionStatusIndicator />
        </nav>
        {/* Mobile Hamburger */}
        <button className="md:hidden p-2 rounded hover:bg-muted focus:outline-none" onClick={() => setMobileNavOpen(v => !v)}>
          <Menu className="h-6 w-6" />
        </button>
      </div>
      {/* Mobile Nav Drawer */}
      {mobileNavOpen && (
        <div className="md:hidden bg-card border-t border-border px-4 pb-4 pt-2 flex flex-col gap-2 animate-fade-in-down">
          <Button variant="ghost" asChild className="w-full justify-start" onClick={() => setMobileNavOpen(false)}>
            <Link href="/">Dashboard</Link>
          </Button>
          {isAdmin && (
            <Button variant="ghost" asChild className="w-full justify-start" onClick={() => setMobileNavOpen(false)}>
              <Link href="/settings">Settings</Link>
            </Button>
          )}
          <div className="mt-2">
            <ConnectionStatusIndicator />
          </div>
        </div>
      )}
    </header>
  );
}

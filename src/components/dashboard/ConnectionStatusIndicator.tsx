"use client";

import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Status = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function ConnectionStatusIndicator() {
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState<string>('Connecting to backend...');
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    async function checkStatus() {
      setStatus('connecting');
      setMessage('Attempting to connect to backend...');
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          setStatus('connected');
          setMessage(data.message || 'Backend is running!');
          setLastChecked(new Date().toLocaleTimeString());
        } else {
          setStatus('error');
          setMessage(`Error: ${response.statusText} (Status: ${response.status})`);
          setLastChecked(new Date().toLocaleTimeString());
        }
      } catch (error) {
        setStatus('disconnected');
        setMessage('Failed to connect to backend.');
        setLastChecked(new Date().toLocaleTimeString());
      }
    }
    checkStatus();
    // Optionally, set up an interval to re-check status
    // const intervalId = setInterval(checkStatus, 30000); // Check every 30 seconds
    // return () => clearInterval(intervalId);
  }, []);

  const getStatusAttributes = () => {
    switch (status) {
      case 'connecting':
        return {
          Icon: Loader2,
          color: 'bg-blue-500 text-blue-50',
          className: 'animate-spin',
          text: 'Connecting...',
          tooltipText: `Status: Connecting. ${message}`
        };
      case 'connected':
        return {
          Icon: CheckCircle2,
          color: 'bg-green-500 text-green-50',
          className: '',
          text: 'Connected',
          tooltipText: `Status: Connected. ${message}${lastChecked ? ` Last checked: ${lastChecked}` : ''}`
        };
      case 'disconnected':
        return {
          Icon: WifiOff,
          color: 'bg-red-500 text-red-50',
          className: '',
          text: 'Disconnected',
          tooltipText: `Status: Disconnected. ${message}${lastChecked ? ` Last checked: ${lastChecked}` : ''}`
        };
      case 'error':
        return {
          Icon: AlertTriangle,
          color: 'bg-yellow-500 text-yellow-50',
          className: '',
          text: 'Error',
          tooltipText: `Status: Error. ${message}${lastChecked ? ` Last checked: ${lastChecked}` : ''}`
        };
      default:
        return {
          Icon: Wifi,
          color: 'bg-gray-500 text-gray-50',
          className: '',
          text: 'Unknown',
          tooltipText: `Status: Unknown. ${message}`
        };
    }
  };

  const { Icon, color, className, text, tooltipText } = getStatusAttributes();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`px-3 py-1.5 text-sm flex items-center gap-2 border-0 ${color} cursor-default`}>
            <Icon className={`h-4 w-4 ${className}`} />
            <span>{text}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

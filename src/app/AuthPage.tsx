"use client";
import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';

const GradientBg = styled('div')({
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #e0e7ff 0%, #6366f1 100%)',
});

export default function AuthPage() {
    const { login, signup } = useAuth();
    const [isSignup, setIsSignup] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        if (isSignup) {
            const ok = await signup(username, password);
            if (!ok) setError('Username already exists.');
        } else {
            const ok = await login(username, password);
            if (!ok) setError('Invalid username or password.');
        }
        setLoading(false);
    };

    return (
        <GradientBg>
            <Card className="w-full max-w-md shadow-2xl rounded-2xl animate-fade-in" sx={{ borderRadius: 4, boxShadow: 8, p: 2 }}>
                <CardContent className="flex flex-col items-center">
                    <div className="mb-6 text-center w-full">
                        <Typography variant="h4" component="h1" className="font-headline" sx={{ color: '#4338ca', fontWeight: 700, mb: 1 }}>
                            SensorFlow Dashboard
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748b' }}>
                            Sign {isSignup ? 'Up' : 'In'} to continue
                        </Typography>
                    </div>
                    <form className="w-full" onSubmit={handleSubmit} autoComplete="off">
                        <TextField
                            label="Username"
                            variant="outlined"
                            fullWidth
                            margin="normal"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoFocus
                            InputProps={{ className: 'bg-white' }}
                        />
                        <TextField
                            label="Password"
                            variant="outlined"
                            type="password"
                            fullWidth
                            margin="normal"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            InputProps={{ className: 'bg-white' }}
                        />
                        {error && <Typography color="error" variant="body2" className="text-center mt-2">{error}</Typography>}
                        <Button
                            type="submit"
                            variant="contained"
                            color="primary"
                            fullWidth
                            size="large"
                            sx={{ mt: 2, borderRadius: 2, fontWeight: 600, boxShadow: 2, textTransform: 'none', letterSpacing: 1 }}
                            disabled={loading}
                        >
                            {loading ? <CircularProgress size={24} color="inherit" /> : (isSignup ? 'Sign Up' : 'Sign In')}
                        </Button>
                    </form>
                    <div className="text-sm text-gray-500 mt-4 w-full text-center">
                        {isSignup ? 'Already have an account?' : "Don't have an account?"}
                        <Button
                            variant="text"
                            color="primary"
                            size="small"
                            sx={{ ml: 1, fontWeight: 600, textTransform: 'none' }}
                            onClick={() => { setIsSignup(!isSignup); setError(''); }}
                        >
                            {isSignup ? 'Sign In' : 'Sign Up'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </GradientBg>
    );
} 
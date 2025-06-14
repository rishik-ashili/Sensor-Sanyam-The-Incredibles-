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
import { Tabs, Tab } from '@mui/material';

const GradientBg = styled('div')({
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #e0e7ff 0%, #6366f1 100%)',
    padding: '1rem',
});

export default function AuthPage() {
    const { login, signup } = useAuth();
    const [isSignup, setIsSignup] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
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
            const ok = await login(username, password, isAdmin);
            if (!ok) setError('Invalid username or password.');
        }
        setLoading(false);
    };

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setIsAdmin(newValue === 1);
        setError('');
    };

    return (
        <GradientBg>
            <Card className="w-full max-w-xs sm:max-w-md shadow-2xl rounded-2xl animate-fade-in" sx={{ borderRadius: 4, boxShadow: 8, p: { xs: 1, sm: 2 } }}>
                <CardContent className="flex flex-col items-center p-2 sm:p-6">
                    <div className="mb-6 text-center w-full">
                        <img src="/logo.png" alt="Dashboard Logo" className="mx-auto mb-4 h-24 w-auto drop-shadow-lg" />
                        <Typography variant="body2" sx={{ color: '#64748b' }}>
                            Sign {isSignup ? 'Up' : 'In'} to continue
                        </Typography>
                    </div>

                    {!isSignup && (
                        <Tabs
                            value={isAdmin ? 1 : 0}
                            onChange={handleTabChange}
                            className="w-full mb-4"
                            sx={{
                                '& .MuiTab-root': {
                                    textTransform: 'none',
                                    fontWeight: 600,
                                },
                            }}
                        >
                            <Tab label="User Login" />
                            <Tab label="Admin Login" />
                        </Tabs>
                    )}

                    <form className="w-full space-y-2" onSubmit={handleSubmit} autoComplete="off">
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
                    {!isAdmin && (
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
                    )}
                </CardContent>
            </Card>
        </GradientBg>
    );
} 
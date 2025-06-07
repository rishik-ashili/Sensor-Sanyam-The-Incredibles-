"use client";
import React, { useState } from 'react';
import { useAuth } from './AuthContext';

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
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 to-blue-200">
            <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-2xl flex flex-col items-center animate-fade-in">
                <div className="mb-6 text-center">
                    <h1 className="text-3xl font-bold font-headline text-indigo-700 mb-2">SensorFlow Dashboard</h1>
                    <p className="text-gray-500 text-sm">Sign {isSignup ? 'Up' : 'In'} to continue</p>
                </div>
                <form className="w-full" onSubmit={handleSubmit}>
                    <input
                        className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 transition"
                        type="text"
                        placeholder="Username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        required
                        autoFocus
                    />
                    <input
                        className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 transition"
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                    />
                    {error && <div className="text-red-500 text-sm mb-2 text-center">{error}</div>}
                    <button
                        type="submit"
                        className="w-full py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition mb-2 disabled:opacity-60"
                        disabled={loading}
                    >
                        {loading ? (isSignup ? 'Signing Up...' : 'Signing In...') : (isSignup ? 'Sign Up' : 'Sign In')}
                    </button>
                </form>
                <div className="text-sm text-gray-500 mt-2">
                    {isSignup ? 'Already have an account?' : "Don't have an account?"}
                    <button
                        className="ml-1 text-indigo-600 hover:underline font-medium"
                        onClick={() => { setIsSignup(!isSignup); setError(''); }}
                    >
                        {isSignup ? 'Sign In' : 'Sign Up'}
                    </button>
                </div>
            </div>
        </div>
    );
} 
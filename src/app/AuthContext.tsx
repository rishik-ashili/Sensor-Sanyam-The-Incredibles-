"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
    user: string | null;
    role: 'admin' | 'user' | null;
    login: (username: string, password: string, isAdmin: boolean) => Promise<boolean>;
    signup: (username: string, password: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_USER_KEY = 'sensorflow_user';
const LOCAL_AUTH_KEY = 'sensorflow_auth';
const LOCAL_ROLE_KEY = 'sensorflow_role';

// Hardcoded admin credentials
const ADMIN_USERNAME = 'admin123';
const ADMIN_PASSWORD = 'admin@123';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<string | null>(null);
    const [role, setRole] = useState<'admin' | 'user' | null>(null);

    useEffect(() => {
        const auth = localStorage.getItem(LOCAL_AUTH_KEY);
        const userRole = localStorage.getItem(LOCAL_ROLE_KEY) as 'admin' | 'user' | null;
        if (auth) {
            setUser(auth);
            setRole(userRole);
        }
    }, []);

    const login = async (username: string, password: string, isAdmin: boolean) => {
        if (isAdmin) {
            if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
                localStorage.setItem(LOCAL_AUTH_KEY, username);
                localStorage.setItem(LOCAL_ROLE_KEY, 'admin');
                setUser(username);
                setRole('admin');
                return true;
            }
            return false;
        }

        const users = JSON.parse(localStorage.getItem(LOCAL_USER_KEY) || '{}');
        if (users[username] && users[username] === password) {
            localStorage.setItem(LOCAL_AUTH_KEY, username);
            localStorage.setItem(LOCAL_ROLE_KEY, 'user');
            setUser(username);
            setRole('user');
            return true;
        }
        return false;
    };

    const signup = async (username: string, password: string) => {
        let users = JSON.parse(localStorage.getItem(LOCAL_USER_KEY) || '{}');
        if (users[username]) {
            return false; // User exists
        }
        users[username] = password;
        localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(users));
        localStorage.setItem(LOCAL_AUTH_KEY, username);
        localStorage.setItem(LOCAL_ROLE_KEY, 'user');
        setUser(username);
        setRole('user');
        return true;
    };

    const logout = () => {
        localStorage.removeItem(LOCAL_AUTH_KEY);
        localStorage.removeItem(LOCAL_ROLE_KEY);
        setUser(null);
        setRole(null);
    };

    return (
        <AuthContext.Provider value={{ user, role, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
} 
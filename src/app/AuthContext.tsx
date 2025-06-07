import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
    user: string | null;
    login: (username: string, password: string) => Promise<boolean>;
    signup: (username: string, password: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_USER_KEY = 'sensorflow_user';
const LOCAL_AUTH_KEY = 'sensorflow_auth';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<string | null>(null);

    useEffect(() => {
        const auth = localStorage.getItem(LOCAL_AUTH_KEY);
        if (auth) {
            setUser(auth);
        }
    }, []);

    const login = async (username: string, password: string) => {
        const users = JSON.parse(localStorage.getItem(LOCAL_USER_KEY) || '{}');
        if (users[username] && users[username] === password) {
            localStorage.setItem(LOCAL_AUTH_KEY, username);
            setUser(username);
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
        setUser(username);
        return true;
    };

    const logout = () => {
        localStorage.removeItem(LOCAL_AUTH_KEY);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
} 
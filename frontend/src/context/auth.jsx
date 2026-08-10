import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

// Tracks the current session: whether the visitor is signed in, which admin
// user they are, and whether the initial admin registration is still open
// (true only while no user exists at all).
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | ready
  const [user, setUser] = useState(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .authStatus()
      .then((state) => {
        if (cancelled) return;
        setUser(state.authenticated ? state.user : null);
        setRegistrationOpen(Boolean(state.registrationOpen));
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setRegistrationOpen(false);
        setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from a protected endpoint (expired/revoked session) drops back to
  // the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await api.login(username, password);
    setUser(result.user);
    setRegistrationOpen(false);
    return result.user;
  }, []);

  const register = useCallback(async (username, password) => {
    const result = await api.register(username, password);
    setUser(result.user);
    setRegistrationOpen(false);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, registrationOpen, login, register, logout }),
    [status, user, registrationOpen, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

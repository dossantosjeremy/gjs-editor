import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, isRemote } from './supabase';

interface AuthState {
  user:    User | null;
  loading: boolean;
  signIn:  (email: string, password: string) => Promise<string | null>;
  signUp:  (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const LOCAL_USER = { id: 'local', email: 'local' } as unknown as User;

const AuthContext = createContext<AuthState>({
  user:    LOCAL_USER,
  loading: false,
  signIn:  async () => null,
  signUp:  async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(isRemote ? null : LOCAL_USER);
  const [loading, setLoading] = useState(isRemote);

  useEffect(() => {
    if (!isRemote || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return null;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  };

  const signUp = async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return null;
    const { error } = await supabase.auth.signUp({ email, password });
    return error?.message ?? null;
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

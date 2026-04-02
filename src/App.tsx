import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isRemote } from './lib/supabase';
import { SiteList } from './pages/SiteList';
import { SiteEditor } from './pages/SiteEditor';
import { Login } from './pages/Login';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (!isRemote) return <>{children}</>;
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
      <span style={{ color: '#86868b', fontSize: 14 }}>Loading…</span>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/"            element={<AuthGuard><SiteList /></AuthGuard>} />
          <Route path="/site/:siteId" element={<AuthGuard><SiteEditor /></AuthGuard>} />
          <Route path="*"            element={<AuthGuard><SiteList /></AuthGuard>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

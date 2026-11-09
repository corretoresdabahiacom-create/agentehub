import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ProtectedRoute, PublicOnly } from './components/Guards';
import { LoginPage, SignupPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import { NotFoundPage, OfflinePage } from './pages/Misc';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route element={<PublicOnly />}>
          <Route path="signup" element={<SignupPage />} />
          <Route path="login" element={<LoginPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="app" element={<Dashboard />} />
        </Route>
        <Route path="offline" element={<OfflinePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

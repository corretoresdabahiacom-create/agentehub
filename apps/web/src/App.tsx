import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ProtectedRoute, PublicOnly } from './components/Guards';
import { LoginPage, SignupPage } from './pages/Auth';
import AgentPage from './pages/AgentPage';
import BuilderEditPage from './pages/BuilderEditPage';
import BuilderPage from './pages/BuilderPage';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import Marketplace from './pages/Marketplace';
import { NotFoundPage, OfflinePage } from './pages/Misc';
import RunPage from './pages/RunPage';
import RunsPage from './pages/RunsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="agents" element={<Marketplace />} />
        <Route path="agents/:slug" element={<AgentPage />} />
        <Route element={<PublicOnly />}>
          <Route path="signup" element={<SignupPage />} />
          <Route path="login" element={<LoginPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="app" element={<Dashboard />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="builder/:id" element={<BuilderEditPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:id" element={<RunPage />} />
        </Route>
        <Route path="offline" element={<OfflinePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

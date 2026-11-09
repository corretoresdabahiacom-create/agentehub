import { Navigate, Outlet } from 'react-router';
import { useMe } from '../lib/queries';

export function ProtectedRoute() {
  const me = useMe();
  if (me.isPending) return <p aria-busy="true">…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const me = useMe();
  if (me.isPending) return <p aria-busy="true">…</p>;
  if (me.data) return <Navigate to="/app" replace />;
  return <Outlet />;
}

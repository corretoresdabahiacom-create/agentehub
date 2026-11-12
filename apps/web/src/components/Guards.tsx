import { Navigate, Outlet, useLocation } from 'react-router';
import { safeNext } from '../lib/next';
import { useMe } from '../lib/queries';

export function ProtectedRoute() {
  const me = useMe();
  if (me.isPending) return <p aria-busy="true">…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const me = useMe();
  const { search } = useLocation();
  if (me.isPending) return <p aria-busy="true">…</p>;
  if (me.data) return <Navigate to={safeNext(search) ?? '/app'} replace />;
  return <Outlet />;
}

import { useAuth } from '../context/AuthContext';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Loader from '../loader/Loader';

const PUBLIC_ROUTES = new Set(['/', '/auth/login', '/auth/signup', '/privacy', '/terms', '/404']);

export default function ProtectedRoute({ children }) {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const isPublic = PUBLIC_ROUTES.has(router.pathname);

  useEffect(() => {
    if (!isPublic && !loading && !isAuthenticated) {
      router.replace(`/auth/login?next=${encodeURIComponent(router.asPath)}`);
    }
  }, [isPublic, loading, isAuthenticated, router]);

  if (isPublic) return children;
  if (loading || !isAuthenticated) return <Loader />;
  return children;
}

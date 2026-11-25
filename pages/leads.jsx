import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Loader from '../loader/Loader';

// The old Leads page was replaced by My Leads. Keep this route so existing
// links and bookmarks still work.
export default function LeadsRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    router.replace({ pathname: '/my-leads', query: router.query });
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="flex min-h-screen items-center justify-center"><Loader /></div>;
}

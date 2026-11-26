import { useEffect } from "react";
import { useRouter } from "next/router";

// Employee accounts are created by the company admin in the admin panel.
// Self sign-up here used to create company records from the browser; it now
// sends people to the sign-in page instead.
export default function EmployeeSignup() {
  const router = useRouter();
  useEffect(() => { router.replace("/auth/login"); }, [router]);
  return null;
}

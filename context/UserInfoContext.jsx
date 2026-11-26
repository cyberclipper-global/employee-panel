import React, { createContext, useContext, useEffect, useMemo } from "react";
import useStoreUserInfoEdit from "../hooks/useStoreUserInfoEdit";
import { useAuth } from "./AuthContext";

const UserInfoContext = createContext();

export function useUserInfo() {
  return useContext(UserInfoContext);
}

// Profile of the signed-in employee. Company and employee ids come from the
// server session (AuthContext), never from the URL or browser storage.
export function UserInfoProvider({ children }) {
  const { user: sessionUser } = useAuth();
  const ci = sessionUser?.companyId || null;
  const aid = sessionUser?.employeeId || null;
  const { user, loading, error, fetchUser } = useStoreUserInfoEdit(ci, aid);

  useEffect(() => {
    if (ci && aid) fetchUser();
  }, [ci, aid, fetchUser]);

  const value = useMemo(() => ({ user, loading, error, fetchUser, aid }), [user, loading, error, fetchUser, aid]);
  return <UserInfoContext.Provider value={value}>{children}</UserInfoContext.Provider>;
}

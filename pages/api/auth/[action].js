// Employee authentication API: /api/auth/<action>
import { authRouter } from '@/lib/auth/core';
import { employeeAuth, ensureEmployeeProfile } from '@/lib/auth/employee';

export default authRouter(employeeAuth, {
  me: ['GET', async (req) => {
    const { principal } = await employeeAuth.requireSession(req);
    await ensureEmployeeProfile(principal.companyId, principal.employeeId);
    return {
      user: {
        companyId: principal.companyId,
        employeeId: principal.employeeId,
        name: principal.name,
        email: principal.email,
        role: principal.role,
        companyName: principal.companyName || '',
      },
      firebaseUid: `emp:${principal.companyId}:${principal.employeeId}`.slice(0, 128),
    };
  }],
});

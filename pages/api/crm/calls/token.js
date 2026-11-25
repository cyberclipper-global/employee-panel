import { crmHandler, rateLimit } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { plivoConfig, createAccessToken, plivoIdentity } from '@/lib/crm/plivo';

// Short-lived Plivo Browser SDK access token (outgoing calls only). It lets
// the browser connect to Plivo; it does not reveal any customer number.
export default crmHandler({
  POST: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    rateLimit(`crm-plivo-token:${companyId}:${employeeId}`, 20, 10 * 60 * 1000);
    const cfg = plivoConfig();
    const { token, expiresAt } = await createAccessToken(cfg, plivoIdentity(companyId, employeeId));
    return res.status(200).json({ token, expiresAt });
  },
});

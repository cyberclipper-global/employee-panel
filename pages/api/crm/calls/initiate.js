import { crmHandler, rateLimit } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { badRequest } from '@/lib/crm/errors';
import { plivoConfig, plivoIdentity } from '@/lib/crm/plivo';
import { initiateCall } from '@/lib/crm/calls';

// Starts a call to an assigned lead. The response holds a single-use call
// token, never the phone number; the number is resolved by the Answer URL.
export default crmHandler({
  POST: async (req, res) => {
    const session = await requireEmployee(req);
    rateLimit(`crm-call:${session.companyId}:${session.employeeId}`, 12, 60 * 1000);
    plivoConfig();
    const leadId = req.body?.leadId;
    if (typeof leadId !== 'string' || !leadId) throw badRequest('leadId is required');
    const result = await initiateCall(session, leadId, plivoIdentity(session.companyId, session.employeeId));
    return res.status(201).json({
      callId: result.callId,
      leadName: result.leadName,
      // What the browser dials and the header it sends. Both carry only the token.
      destination: `cc${result.callToken}`,
      headers: { 'X-PH-CallToken': result.callToken },
    });
  },
});

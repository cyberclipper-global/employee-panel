import { crmHandler, queryString } from '@/lib/crm/http';
import { requireEmployee } from '@/lib/crm/employeeAuth';
import { refs } from '@/lib/crm/firestore';
import { serializeCall, encodeCursor } from '@/lib/crm/leads';
import { plivoConfig } from '@/lib/crm/plivo';

// The signed-in employee's own call history. No phone numbers are stored here.
export default crmHandler({
  GET: async (req, res) => {
    const { companyId, employeeId } = await requireEmployee(req);
    const size = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), 100);
    let q = refs.calls(companyId).where('employeeId', '==', employeeId).orderBy('createdAt', 'desc').limit(size + 1);
    const cursor = queryString(req.query.cursor, 300);
    if (cursor) {
      const id = Buffer.from(cursor, 'base64url').toString('utf8');
      if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        const snap = await refs.calls(companyId).doc(id).get();
        if (snap.exists && snap.get('employeeId') === employeeId) q = q.startAfter(snap);
      }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, size);
    return res.status(200).json({
      calls: docs.map(serializeCall),
      nextCursor: snap.docs.length > size ? encodeCursor(docs[docs.length - 1].id) : null,
      callingEnabled: plivoConfig({ required: false }).configured,
    });
  },
});

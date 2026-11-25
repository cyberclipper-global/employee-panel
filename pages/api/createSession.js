import jwt from 'jsonwebtoken';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { rateLimit, clientIp } from '@/lib/crm/http';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, employeeId, days = 7 } = req.body;

    // Validate required parameters
    if (!companyId || !employeeId || typeof companyId !== 'string' || typeof employeeId !== 'string' || companyId.includes('/') || employeeId.includes('/')) {
      return res.status(400).json({ 
        error: 'Missing required parameters: companyId, employeeId' 
      });
    }

    // Slow down guessing and only sign sessions for employees that exist
    // (the same check the login page performs). Without this, anyone could
    // mint a session for any id pair.
    try {
      rateLimit(`create-session:${clientIp(req)}`, 30, 10 * 60 * 1000);
    } catch {
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    const employeeSnap = await getDoc(doc(db, 'users', companyId, 'employees', employeeId));
    if (!employeeSnap.exists()) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get JWT secret from environment
    const SESSION_SECRET = process.env.SESSION_SECRET;
    if (!SESSION_SECRET) {
      return res.status(500).json({ 
        error: 'SESSION_SECRET not configured' 
      });
    }

    // Create session data
    const sessionData = { 
      companyId, 
      employeeId, 
      timestamp: Date.now()
    };
    const safeDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    
    // Sign the session data with JWT
    const token = jwt.sign(sessionData, SESSION_SECRET, { 
      algorithm: 'HS256',
      expiresIn: `${safeDays}d`
    });

    return res.status(200).json({ 
      success: true,
      token: token
    });

  } catch (error) {
    return res.status(500).json({ 
      error: 'Failed to create session'
    });
  }
}

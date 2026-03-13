import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { readDb, withDb, nextId, nowIso, role } from './store.js';
import { findUserByEmail, findUserById, saveUser } from './repositories/userRepository.js';

const JWT_SECRET = process.env.JWT_SECRET || 'telerelation-finance-dev-secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = readDb();
    const persisted = findUserById(db, decoded.sub);
    req.user = {
      ...decoded,
      ...(persisted ? safeUser(persisted) : {}),
      allowedEntities: Array.isArray(persisted?.allowedEntities) ? persisted.allowedEntities : []
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    return next();
  };
}

export function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    allowedEntities: Array.isArray(user.allowedEntities) ? user.allowedEntities : [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export async function loginWithPassword(email, password) {
  const db = readDb();
  const user = findUserByEmail(db, email);
  if (!user || !user.passwordHash) return null;
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) return null;
  return {
    token: signSession(user),
    user: safeUser(user)
  };
}

function decodeGoogleTokenUnsafe(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) throw new Error('Malformed Google ID token.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  return payload;
}

export async function loginWithGoogle(idToken) {
  let payload = null;
  if (googleClient && GOOGLE_CLIENT_ID) {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } else {
    payload = decodeGoogleTokenUnsafe(idToken);
  }

  if (!payload?.email) throw new Error('Google token missing email claim.');

  const user = withDb((db) => {
    const existing = findUserByEmail(db, payload.email);
    if (existing) {
      existing.googleSub = payload.sub || existing.googleSub || null;
      existing.updatedAt = nowIso();
      if (existing.role === role.VIEWER && String(payload.email).endsWith('@telerelation.local')) {
        existing.role = role.EMPLOYEE;
      }
      return saveUser(db, existing);
    }
    const id = nextId(db, 'USER', 'USR');
    const created = {
      id,
      name: payload.name || payload.email.split('@')[0],
      email: payload.email,
      role: String(payload.email).endsWith('@telerelation.local') ? role.EMPLOYEE : role.VIEWER,
      passwordHash: null,
      googleSub: payload.sub || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    return saveUser(db, created);
  });

  return {
    token: signSession(user),
    user: safeUser(user)
  };
}

export function currentUser(req) {
  const db = readDb();
  const user = findUserById(db, req.user?.sub);
  return user ? safeUser(user) : null;
}

import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
export const opaque = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function passwordHash(password) {
  const salt=opaque();
  return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
export async function checkPassword(password, encoded) {
  if (typeof password!=='string' || password.length>256 || typeof encoded!=='string' || !/^[A-Za-z0-9_-]+:[0-9a-f]{128}$/.test(encoded)) return false;
  const [salt,digest]=encoded.split(':');
  const expected=Buffer.from(digest ?? '', 'hex');
  const actual=await scrypt(password,salt,64);
  return expected.length===actual.length && timingSafeEqual(expected,actual);
}
export function cookieValue(req,name) {
  return (req.headers.cookie ?? '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
}

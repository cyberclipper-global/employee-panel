import CryptoJS from "crypto-js";


// Identity no longer travels in the URL; see utils/session.js.
export { decryptToken } from './session';

/**
 * Encrypts text using AES.
 * @param {string} text
 * @param {string} password
 * @returns {string}
 */
export function encryptKey(text, password) {
  return CryptoJS.AES.encrypt(text, password).toString();
}

/**
 * Decrypts AES-encrypted text.
 * @param {string} encryptedText
 * @param {string} password
 * @returns {string|null}
 */
export function decryptKey(encryptedText, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, password);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return null;
  }
}

/**
 * Formats the remaining lockout time as a string.
 * @param {Date|null} lockoutUntil
 * @returns {string}
 */
export function getRemainingLockoutTime(lockoutUntil) {
  if (!lockoutUntil) return "";
  const now = new Date();
  const diff = lockoutUntil - now;
  if (diff <= 0) return "";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
} 
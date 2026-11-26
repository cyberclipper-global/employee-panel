// Error type used by every CRM API route. The message is safe to show to the
// caller; never put phone numbers, tokens or other secrets in it.
export class CrmError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'CrmError';
    this.status = status;
    this.code = code || undefined;
  }
}

export const badRequest = (msg, code) => new CrmError(400, msg, code);
export const unauthorized = (msg = 'Not signed in') => new CrmError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to this resource') => new CrmError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new CrmError(404, msg, 'not_found');
export const conflict = (msg, code) => new CrmError(409, msg, code || 'conflict');

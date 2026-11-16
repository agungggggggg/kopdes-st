// =====================================================================
// ERROR BER-STATUS: dilempar dari route/service mana pun, ditangkap
// error handler terpusat di server.js dan diubah menjadi respons
// { error: { message, ...extra } } sesuai kontrak API.
// Contoh: throw new HttpError(409, 'Stok tidak cukup', { detail: [...] })
// =====================================================================
class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.name = 'HttpError';
    this.httpStatus = status;
    this.extra = extra;
  }
}

module.exports = HttpError;

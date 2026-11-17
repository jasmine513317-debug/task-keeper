declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** HMAC key for session cookies. Must be at least 32 characters; auth refuses to run without it. */
    AUTH_SECRET?: string;
    /** PBKDF2 rounds for new password hashes, bounded by the Worker CPU slice. */
    AUTH_PBKDF2_ITERATIONS?: string;
  }
}

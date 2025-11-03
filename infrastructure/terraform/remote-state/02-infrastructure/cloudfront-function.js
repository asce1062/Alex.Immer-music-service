/**
 * CloudFront Function - Referer-based Access Control (Hotlink Protection)
 *
 * This lightweight function runs on CloudFront edge locations to protect music
 * files from unauthorized hotlinking. It checks the HTTP Referer header against
 * an allowlist of authorized domains.
 *
 * Behavior:
 * - No referer (direct navigation, audio players, download managers): ALLOW
 * - Referer matches allowlist: ALLOW
 * - Referer does not match allowlist: REJECT with 403 Forbidden
 *
 * Note: The allowlist is hardcoded in this function. To update it, modify the
 * `allowlist` array below and redeploy with `terraform apply`.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handler(event) {
  var request = event.request;
  var headers = request.headers || {};
  var referer = (headers.referer && headers.referer.value) || '';

  // Allowlist of authorized domains
  // Update this list in Terraform variable `allowed_referers` and redeploy
  var allowlist = [
    // Production domains
    'https://alexmbugua.me',
    'https://www.alexmbugua.me',
    'https://asce1062.github.io',

    // Development (localhost)
    'http://localhost:4321', // Astro dev server
    'http://localhost:4322', // Astro additional server
    'http://localhost:3000', // Common dev port
    'http://localhost:8080', // Common dev port
    'http://localhost:8888', // Netlify local preview server
    'http://127.0.0.1:4321', // Astro dev (IPv4)
    'http://127.0.0.1:3000', // Common dev (IPv4)
    'http://127.0.0.1:8080', // Common dev (IPv4)
    'http://127.0.0.1:8888', // Netlify local preview server

    // Netlify Deploy Previews: Add specific preview URLs as needed
    'https://alexmbugua.netlify.app',
  ];

  // If no referer, allow (direct navigation, audio players, download managers)
  if (!referer) {
    return request;
  }

  // Check if referer matches any allowed origin
  // Use exact domain matching to prevent bypass via domains like "alexmbugua.me-evil.com"
  for (const allowed of allowlist) {
    // Check if referer starts with allowed domain and is followed by / or end of string
    if (referer === allowed || referer === allowed + '/' || referer.indexOf(allowed + '/') === 0) {
      return request;
    }
  }

  // Return 403 Forbidden for unauthorized referers
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'cache-control': { value: 'no-store' },
      'content-type': { value: 'text/plain; charset=utf-8' },
    },
    body: 'Forbidden',
  };
}

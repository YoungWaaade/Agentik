// Which links from agents' messages may be opened, and where a bare URL really ends.

// Only web links (http, https, localhost included) are clickable and open in a new browser tab.
// Anything else (javascript:, data:, file:, malformed URLs) is never turned into a link.
export function safeHref(href) {
  try {
    const u = new URL(String(href).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}
// A bare URL doesn't take the sentence's punctuation: "sur http://localhost:4399, avec…" must link
// to http://localhost:4399 (with the comma, the port is invalid and Chrome opens about:blank#blocked).
export function trimUrl(url) {
  let u = url.replace(/[.,;:!?'"`*»”’]+$/, '');
  while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1).replace(/[.,;:!?'"`*»”’]+$/, '');
  return u;
}
// Local paths (/Users/…, ~/…, ./…, file:…) are shown as text: a web page can't open them.
export const isPath = (h) => /^(\/|~\/|\.{1,2}\/|file:)/i.test(String(h).trim());

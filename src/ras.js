// "RAS" (rien à signaler) alone, the answer an agent gives when a wake-up or a report has nothing for the
// user: nothing is shown, relayed or notified. Case, spaces, punctuation and Markdown don't matter.
// Shared by the server (chat, scheduler, reports) and the app (notifications).
export function isRAS(text) {
  return String(text ?? '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === 'ras';
}

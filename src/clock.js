// Offset between the server's clock and this device's: timestamps sent by the server (turn starts…) are
// compared with serverNow(), so a phone whose clock is a bit off still shows the right elapsed time.
let offset = 0;
export function noteServerNow(t) {
  if (Number.isFinite(t)) offset = t - Date.now();
}
export const serverNow = () => Date.now() + offset;

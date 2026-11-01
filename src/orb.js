// The orb: default avatar of every agent without a profile photo. One animation for all of them, the
// original GIF (public/agents/originals/orb.gif) cropped on its pink glass sphere and played as a muted
// looping video (public/agents/orb/, made by scripts/agent-orb.mjs; playback in src/orbVideo.js).
//
// Avatar spec of the orb: "/agents/orb/orb.png", its still image, so the server (push.js) finds the
// notification icon without knowing about orbs. Specs of the former WebGL orbs ("/agents/orbs/<palette>.png")
// still mean the orb.
export const ORB_SPEC = '/agents/orb/orb.png';
export const ORB_STILL = ORB_SPEC;
export const ORB_ACCENT = '#ff3d9a';
export const ORB_SOURCES = [['/agents/orb/orb.mp4', 'video/mp4'], ['/agents/orb/orb.webm', 'video/webm']];
// Animated image fallbacks (video can't autoplay, e.g. iOS Low Power Mode): lossless WebP, else the GIF.
export const ORB_WEBP = '/agents/orb/orb.webp';
export const ORB_GIF = '/agents/orb/orb.gif';
const ORB_RE = /^\/?agents\/orbs?\/[a-z0-9-]+\.png$/;
export const isOrb = (spec) => typeof spec === 'string' && ORB_RE.test(spec);

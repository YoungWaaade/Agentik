// Accent colour swatches + free colour input, shared by the Settings (desktop) and the phone's list header.
import { ACCENT_PRESETS } from '../accentColors.js';
import { setAccent, useAccent } from '../accent.js';

export default function AccentPicker() {
  const accent = useAccent();
  const pick = (v) => setAccent(v).catch((e) => alert(e.message));
  const custom = accent && !ACCENT_PRESETS.some(([v]) => v === accent);
  return (
    <div className="accent-picker">
      {ACCENT_PRESETS.map(([v, label, swatch]) => (
        <button key={label} className={`accent-swatch ${accent === v ? 'on' : ''}`} style={{ background: swatch || v }} onClick={() => pick(v)} aria-label={v ? label : `${label} (par défaut)`} aria-pressed={accent === v} title={v ? label : `${label} (par défaut)`} />
      ))}
      <label className={`accent-swatch accent-custom ${custom ? 'on' : ''}`} style={custom ? { background: accent } : undefined} title="Couleur libre">
        <input type="color" value={accent || ACCENT_PRESETS[0][2]} onChange={(e) => pick(e.target.value)} aria-label="Couleur libre" />
      </label>
      {accent && <button className="accent-reset" onClick={() => pick(null)}>Par défaut</button>}
    </div>
  );
}

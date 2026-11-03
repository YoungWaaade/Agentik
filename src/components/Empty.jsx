import { VscNewFolder } from 'react-icons/vsc';
import { LuPlus } from 'react-icons/lu';

export default function Empty({ onAdd, onSession }) {
  return (
    <div className="empty">
      <img className="empty-logo" src="/icon-192.png" alt="Agentik" width={48} height={48} />
      <h1>Toutes tes sessions Claude Code, au même endroit.</h1>
      <p>Ouvre un projet, lance des agents en parallèle dans des worktrees isolés, suis leur statut et garde une mémoire par projet.</p>
      <div className="empty-actions">
        <button className="btn-primary" onClick={onAdd}><VscNewFolder size={14} /> Ouvrir un projet</button>
        <button className="btn-ghost" onClick={onSession}><LuPlus size={14} /> Session libre</button>
      </div>
    </div>
  );
}

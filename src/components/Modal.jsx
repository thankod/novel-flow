export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="button button-ghost" onClick={onClose} style={{ padding: '0 8px', height: '28px' }}>✕</button>
        </div>
        <div className="stack-form" style={{ padding: '20px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

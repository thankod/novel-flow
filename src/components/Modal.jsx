export function Modal({ label, title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <p className="micro-label">{label}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="stack-form">{children}</div>
      </div>
    </div>
  );
}

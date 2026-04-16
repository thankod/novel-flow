export function Panel({ label, title, actions, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="micro-label">{label}</p>
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

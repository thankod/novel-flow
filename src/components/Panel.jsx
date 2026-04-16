export function Panel({ title, actions, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {actions}
      </div>
      <div className="panel-content">
        {children}
      </div>
    </section>
  );
}

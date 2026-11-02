type Kind = "projects" | "usage" | "connections" | "project" | "content";

function Line({ size = "body" }: { size?: "eyebrow" | "title" | "body" | "short" | "button" }) {
  return <span className={`skeleton skeleton-${size}`} />;
}

function SavedContentPlaceholder() {
  return <section className="workspace-empty" aria-hidden="true">
    <div className="section-heading"><Line size="short" /></div>
    <div className="workspace-empty-paper">
      <div className="workspace-content-placeholder skeleton-copy"><Line /><Line /><Line size="short" /></div>
    </div>
  </section>;
}

export function SavedContentSkeleton() {
  return <div className="page-skeleton saved-content-skeleton" role="status" aria-label="Loading saved content">
    <SavedContentPlaceholder />
  </div>;
}

export function PageSkeleton({ kind, contentOnly = false }: { kind: Kind; contentOnly?: boolean }) {
  if (kind === "projects" && !contentOnly) {
    return <div className="project-library">
      <div className="library-heading">
        <div className="library-heading-copy"><h1>All projects</h1><p>Your videos and everything you create from them.</p></div>
        <span className="skeleton library-loading-action" aria-hidden="true" />
      </div>
      <PageSkeleton kind="projects" contentOnly />
    </div>;
  }
  if (kind === "projects" && contentOnly) {
    return (
      <div className="page-skeleton library-skeleton" role="status" aria-label="Loading projects">
        <div className="library-ledger" aria-hidden="true">
          <div className="library-columns"><Line size="short" /><Line size="short" /><Line size="short" /><span /></div>
          {[0, 1, 2, 3].map(i => (
            <div className="library-row" key={i}>
              <div className="library-identity"><span className="skeleton library-skeleton-icon" /><div className="skeleton-copy"><Line /><Line size="short" /></div></div>
              <div className="library-row-details"><Line size="short" /><span className="library-added"><Line size="short" /></span></div>
              <span />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "project" || kind === "content") {
    return <div className="page-skeleton project-workspace-page project-page-skeleton" role="status" aria-label={`Loading ${kind === "content" ? "project content" : kind}`}>
      {kind === "project" && !contentOnly && <div className="project-source-summary" aria-hidden="true">
        <div className="workspace-skeleton-header skeleton-copy"><Line size="title" /><Line size="short" /></div>
        
      </div>}
      {kind === "project" ? <div className="project-state-skeleton" aria-hidden="true"><span className="skeleton" /><div className="skeleton-copy"><Line size="short" /><Line size="title" /><Line /><Line size="short" /></div></div> : <div className="project-workspace saved-content-skeleton"><SavedContentPlaceholder /></div>}
    </div>;
  }
  return (
    <div className="page-skeleton" role="status" aria-label={`Loading ${kind}`}>
      <div aria-hidden="true">
        {!contentOnly && <div className="page-heading"><div className="skeleton-copy"><Line size="eyebrow" /><Line size="title" /><Line /></div>{kind === "projects" && <Line size="button" />}</div>}
        {kind === "projects" ? <><div className="section-heading"><Line size="short" /></div><div className="project-ledger">{[0, 1, 2].map(i => <div className="project-row" key={i}><Line size="eyebrow" /><div className="project-row-name skeleton-copy skeleton-grow"><Line /><Line size="short" /></div><Line size="short" /></div>)}</div></> :
          kind === "usage" ? <><div className="allowance-period"><div className="skeleton-copy"><Line size="eyebrow" /><Line size="title" /><Line /></div><span className="skeleton allowance-seal" /></div><div className="allowance-ledger"><div className="allowance-head">{[0, 1, 2, 3].map(i => <Line size="short" key={i} />)}</div>{[0, 1, 2, 3, 4, 5, 6].map(i => <div className="allowance-row" key={i}><div className="allowance-name skeleton-copy"><Line size="short" /><Line /></div>{[0, 1, 2].map(j => <Line size="short" key={j} />)}</div>)}</div></> :
          kind === "connections" ? <div className="connection-sheet"><span className="skeleton connection-mark" /><div className="skeleton-copy skeleton-grow"><Line size="eyebrow" /><Line size="title" /><Line /><Line /><Line size="short" /><div className="action-row"><Line size="button" /><Line size="button" /></div></div></div> : null}
      </div>
    </div>
  );
}

import { useMemo } from "react";

export function StoryTree({ story, activeNodeId, onSelect }) {
  const map = useMemo(() => new Map(story.nodes.map((node) => [node.id, node])), [story.nodes]);
  const root = map.get(story.rootNodeId);

  function renderNode(node) {
    const isActive = node.id === activeNodeId;
    return (
      <div className="branch-node-container" key={node.id}>
        <button 
          className={`branch-node ${isActive ? "active" : ""}`} 
          type="button" 
          onClick={() => onSelect(node.id)}
        >
          <div className="branch-node-content">
            {node.content.slice(0, 40) || "空节点"}...
          </div>
          <div className="branch-node-footer">
            <span className="node-meta">{node.generationKind}</span>
            <span className="node-meta">{node.childrenIds.length} children</span>
          </div>
        </button>
        {node.childrenIds.length > 0 ? (
          <div className="branch-children">
            {node.childrenIds.map((childId) => renderNode(map.get(childId)))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="branch-tree">
      {root ? renderNode(root) : <div className="empty-state">暂无分支</div>}
    </div>
  );
}

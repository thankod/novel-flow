import { useMemo } from "react";

export function StoryTree({ story, activeNodeId, onSelect }) {
  const map = useMemo(() => new Map(story.nodes.map((node) => [node.id, node])), [story.nodes]);
  const root = map.get(story.rootNodeId);

  function renderNode(node) {
    return (
      <div className={`branch-node ${node.id === activeNodeId ? "active" : ""}`} key={node.id}>
        <button type="button" onClick={() => onSelect(node.id)}>
          <strong>{node.content.slice(0, 30) || "空节点"}</strong>
          <div className="branch-node-meta">{node.childrenIds.length} 子节点</div>
        </button>
        {node.childrenIds.length > 0 ? (
          <div className="branch-children">
            {node.childrenIds.map((childId) => renderNode(map.get(childId)))}
          </div>
        ) : null}
      </div>
    );
  }

  return root ? renderNode(root) : <div className="empty-state">暂无分支</div>;
}

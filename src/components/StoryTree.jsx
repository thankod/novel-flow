import { useMemo } from "react";
import { GitBranch, ChevronRight } from "lucide-react";

export function StoryTree({ story, activeNodeId, onSelect }) {
  const map = useMemo(() => new Map(story.nodes.map((node) => [node.id, node])), [story.nodes]);
  const root = map.get(story.rootNodeId);

  function renderNode(node, depth = 0) {
    const isActive = node.id === activeNodeId;
    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column' }}>
        <button 
          className={`nav-item ${isActive ? "active" : ""}`} 
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${16 + depth * 12}px` }}
        >
          {depth > 0 ? <GitBranch size={14} style={{ opacity: 0.5 }} /> : <ChevronRight size={14} />}
          <span style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            fontSize: '12px'
          }}>
            {node.content.slice(0, 30) || "空节点"}
          </span>
        </button>
        {node.childrenIds.map((childId) => renderNode(map.get(childId), depth + 1))}
      </div>
    );
  }

  return (
    <div className="nav-section">
      <div className="nav-section-title">剧情分支树</div>
      {root ? renderNode(root) : <div className="empty-state">暂无内容</div>}
    </div>
  );
}

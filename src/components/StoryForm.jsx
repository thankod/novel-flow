import { clamp } from "../lib/storyState";

export function StoryForm({ story, templates, onChange }) {
  function updateField(path, value) {
    const nextStory = structuredClone(story);
    if (path.startsWith("config.")) {
      nextStory.config[path.replace("config.", "")] = value;
    } else {
      nextStory[path] = value;
    }
    nextStory.updatedAt = new Date().toISOString();
    onChange(nextStory);
  }

  return (
    <div className="stack-form" style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '24px' }}>故事详情设定</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div className="stack-form">
          <label>作品标题<input value={story.title} onChange={(e) => updateField("title", e.target.value)} /></label>
          <label>题材 / 风格<input value={story.genre} onChange={(e) => updateField("genre", e.target.value)} /></label>
          <label>世界观设定<textarea rows="5" value={story.config.world} onChange={(e) => updateField("config.world", e.target.value)} /></label>
          <label>核心角色设定<textarea rows="5" value={story.config.characters} onChange={(e) => updateField("config.characters", e.target.value)} /></label>
        </div>

        <div className="stack-form">
          <label>写作目标<textarea rows="3" value={story.config.goals} onChange={(e) => updateField("config.goals", e.target.value)} /></label>
          <label>禁忌项 (AI 避坑)<textarea rows="3" value={story.config.avoid} onChange={(e) => updateField("config.avoid", e.target.value)} /></label>
          <label>系统 Prompt (底层指令)<textarea rows="5" value={story.config.systemPrompt} onChange={(e) => updateField("config.systemPrompt", e.target.value)} /></label>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label>单段长度<input value={story.config.length} onChange={(e) => updateField("config.length", e.target.value)} /></label>
            <label>摘要间隔<input type="number" min="2" max="12" value={story.config.summaryEvery} onChange={(e) => updateField("config.summaryEvery", clamp(Number(e.target.value), 2, 12))} /></label>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '32px', padding: '20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input 
            type="checkbox" 
            id="auto-summary"
            style={{ width: '16px', height: '16px' }}
            checked={story.config.autoSummary} 
            onChange={(e) => updateField("config.autoSummary", e.target.checked)} 
          />
          <label htmlFor="auto-summary" style={{ textTransform: 'none', fontSize: '14px', fontWeight: '500', color: 'var(--text)' }}>
            开启 AI 自动剧情摘要 (推荐)
          </label>
        </div>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          每隔 {story.config.summaryEvery} 个节点自动生成长期记忆
        </p>
      </div>
    </div>
  );
}

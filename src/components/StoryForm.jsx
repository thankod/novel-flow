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
    <div className="stack-form">
      <label>标题<input value={story.title} onChange={(event) => updateField("title", event.target.value)} /></label>
      <label>题材 / 风格<input value={story.genre} onChange={(event) => updateField("genre", event.target.value)} /></label>
      <label>模板<select value={story.templateId} onChange={(event) => updateField("templateId", event.target.value)}><option value="">不使用模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <label>世界观<textarea rows="4" value={story.config.world} onChange={(event) => updateField("config.world", event.target.value)} /></label>
      <label>角色设定<textarea rows="4" value={story.config.characters} onChange={(event) => updateField("config.characters", event.target.value)} /></label>
      <label>写作目标<textarea rows="3" value={story.config.goals} onChange={(event) => updateField("config.goals", event.target.value)} /></label>
      <label>禁忌项<textarea rows="3" value={story.config.avoid} onChange={(event) => updateField("config.avoid", event.target.value)} /></label>
      <label>开场提示<textarea rows="3" value={story.config.openingPrompt} onChange={(event) => updateField("config.openingPrompt", event.target.value)} /></label>
      <label>系统 Prompt<textarea rows="5" value={story.config.systemPrompt} onChange={(event) => updateField("config.systemPrompt", event.target.value)} /></label>
      <label>默认文风<input value={story.config.style} onChange={(event) => updateField("config.style", event.target.value)} /></label>
      <div className="inline-fields">
        <label>单段长度<input value={story.config.length} onChange={(event) => updateField("config.length", event.target.value)} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={story.config.autoSummary} onChange={(event) => updateField("config.autoSummary", event.target.checked)} />自动摘要</label>
      </div>
      <label>自动摘要间隔<input type="number" min="2" max="12" value={story.config.summaryEvery} onChange={(event) => updateField("config.summaryEvery", clamp(Number(event.target.value), 2, 12))} /></label>
    </div>
  );
}

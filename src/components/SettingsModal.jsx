import { useMemo } from "react";
import { Modal } from "./Modal";
import { 
  PROVIDERS, 
  getProviderEntry, 
  listProviderModels, 
  testProviderConnection, 
  defaultBaseURLFor 
} from "../lib/providerDefs";
import { RefreshCw, Play, Save } from "lucide-react";

export function SettingsModal({
  open, activeStory, provider, fields, drafts, modelOptions, testResult, busy,
  onClose, onProviderChange, onFieldsChange, onDraftsChange, onModelOptionsChange, onTestResultChange, onBusyChange, onSave
}) {
  const entry = useMemo(() => getProviderEntry(provider), [provider]);

  if (!open) return null;

  const handleProviderSwitch = (next) => {
    onDraftsChange({ ...drafts, [provider]: { ...fields } });
    onProviderChange(next);
    const draft = drafts[next] || { apiKey: "", model: getProviderEntry(next).defaultModel, baseURL: defaultBaseURLFor(next) };
    onFieldsChange(draft);
    onModelOptionsChange(null);
    onTestResultChange(null);
  };

  const handleListModels = async () => {
    onBusyChange({ listing: true });
    try {
      const models = await listProviderModels({ provider, ...fields });
      onModelOptionsChange(models);
      onTestResultChange({ success: true, message: `成功加载 ${models.length} 个模型` });
    } catch (e) {
      onTestResultChange({ success: false, message: e.message });
    } finally {
      onBusyChange({ listing: false });
    }
  };

  const handleTest = async () => {
    onBusyChange({ testing: true });
    try {
      const res = await testProviderConnection({ provider, ...fields });
      onTestResultChange({ success: true, message: `连接成功: ${res}` });
    } catch (e) {
      onTestResultChange({ success: false, message: e.message });
    } finally {
      onBusyChange({ testing: false });
    }
  };

  return (
    <Modal 
      title="AI 模型与接口设置" 
      onClose={onClose}
      footer={
        <>
          <button className="button button-ghost" onClick={onClose}>取消</button>
          <button className="button button-primary" onClick={() => onSave(fields)}>
            <Save size={16} /> 保存并应用
          </button>
        </>
      }
    >
      <div className="stack-form">
        <label>服务商
          <select value={provider} onChange={e => handleProviderSwitch(e.target.value)}>
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {entry.needsBaseURL && (
          <label>Base URL
            <input 
              value={fields.baseURL} 
              onChange={e => onFieldsChange({...fields, baseURL: e.target.value})} 
              placeholder={entry.baseURLPlaceholder}
            />
          </label>
        )}

        <label>API Key
          <input 
            type="password" 
            value={fields.apiKey} 
            onChange={e => onFieldsChange({...fields, apiKey: e.target.value})} 
            placeholder={entry.keyPlaceholder || "在此输入您的 Key"}
          />
        </label>

        <label>模型名称
          <div style={{ display: 'flex', gap: '8px' }}>
            {modelOptions ? (
              <select style={{ flex: 1 }} value={fields.model} onChange={e => onFieldsChange({...fields, model: e.target.value})}>
                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input style={{ flex: 1 }} value={fields.model} onChange={e => onFieldsChange({...fields, model: e.target.value})} />
            )}
            <button className="button" onClick={handleListModels} disabled={busy.listing}>
              <RefreshCw size={14} className={busy.listing ? "animate-spin" : ""} />
            </button>
          </div>
        </label>

        <div style={{ marginTop: '12px' }}>
          <button className="button" style={{ width: '100%' }} onClick={handleTest} disabled={busy.testing}>
            <Play size={14} style={{ marginRight: '8px' }} /> 测试接口连通性
          </button>
        </div>

        {testResult && (
          <div style={{ 
            marginTop: '12px', 
            padding: '12px', 
            fontSize: '12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid',
            borderColor: testResult.success ? 'var(--success)' : 'var(--danger)',
            background: testResult.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
            color: testResult.success ? 'var(--success)' : 'var(--danger)'
          }}>
            {testResult.message}
          </div>
        )}
      </div>
    </Modal>
  );
}

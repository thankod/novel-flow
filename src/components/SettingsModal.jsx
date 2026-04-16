import { useMemo } from "react";
import { Modal } from "./Modal";
import {
  PROVIDERS,
  createProviderFields,
  emptyProviderFields,
  getProviderEntry,
  listProviderModels,
  migrateModelConfig,
  testProviderConnection,
} from "../lib/providerDefs";

export function SettingsModal({
  open,
  activeStory,
  provider,
  fields,
  drafts,
  modelOptions,
  testResult,
  busy,
  onClose,
  onProviderChange,
  onFieldsChange,
  onDraftsChange,
  onModelOptionsChange,
  onTestResultChange,
  onBusyChange,
  onSave,
}) {
  const entry = useMemo(() => getProviderEntry(provider), [provider]);

  if (!open) return null;

  function stashCurrent() {
    onDraftsChange({
      ...drafts,
      [provider]: { ...fields },
    });
  }

  function handleProviderSwitch(nextProvider) {
    stashCurrent();
    onProviderChange(nextProvider);
    onFieldsChange(drafts[nextProvider] ? { ...drafts[nextProvider] } : createProviderFields({ provider: nextProvider }));
    onModelOptionsChange(null);
    onTestResultChange(null);
  }

  function updateField(key, value) {
    onFieldsChange({
      ...fields,
      [key]: value,
    });
  }

  async function handleTest() {
    onBusyChange({ testing: true });
    onTestResultChange(null);
    try {
      const result = await testProviderConnection({
        ...migrateModelConfig(activeStory?.model),
        provider,
        ...fields,
      });
      onTestResultChange({ success: true, message: result || "OK" });
    } catch (error) {
      onTestResultChange({ success: false, message: error.message || String(error) });
    } finally {
      onBusyChange({ testing: false });
    }
  }

  async function handleListModels() {
    onBusyChange({ listing: true });
    try {
      const models = await listProviderModels({
        ...migrateModelConfig(activeStory?.model),
        provider,
        ...fields,
      });
      onModelOptionsChange(models);
    } catch (error) {
      onModelOptionsChange(entry.presetModels?.length ? entry.presetModels : null);
      onTestResultChange({ success: false, message: error.message || String(error) });
    } finally {
      onBusyChange({ listing: false });
    }
  }

  function handleSave() {
    stashCurrent();
    onSave({
      provider,
      ...fields,
    });
  }

  return (
    <Modal label="Model Settings" title="模型设置" onClose={onClose}>
      <div className="stack-form">
        <label>
          Provider
          <select value={provider} onChange={(event) => handleProviderSwitch(event.target.value)}>
            {PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {!entry.browserSupported ? (
          <div className="settings-alert">{entry.browserHint}</div>
        ) : null}

        {entry.needsBaseURL ? (
          <label>
            Base URL
            <input
              value={fields.baseURL}
              onChange={(event) => updateField("baseURL", event.target.value)}
              placeholder={entry.baseURLPlaceholder || ""}
            />
            {entry.baseUrlHint ? <span className="field-hint">{entry.baseUrlHint}</span> : null}
          </label>
        ) : null}

        <label>
          API Key
          <input
            type="password"
            value={fields.apiKey}
            onChange={(event) => updateField("apiKey", event.target.value)}
            placeholder={entry.keyPlaceholder || ""}
          />
        </label>

        <label>
          Model
          {modelOptions?.length ? (
            <select value={fields.model} onChange={(event) => updateField("model", event.target.value)}>
              <option value="">选择模型</option>
              {modelOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={fields.model}
              onChange={(event) => updateField("model", event.target.value)}
              placeholder={entry.defaultModel}
            />
          )}
        </label>

        <div className="inline-fields">
          <label>
            Temperature
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={activeStory?.model.temperature ?? 0.9}
              onChange={() => {}}
              disabled
            />
          </label>
          <label>
            Max Tokens
            <input
              type="number"
              value={activeStory?.model.maxTokens ?? 900}
              onChange={() => {}}
              disabled
            />
          </label>
        </div>

        <div className="action-row">
          <button className="button button-secondary" onClick={handleListModels} disabled={busy.listing || !entry.browserSupported}>
            {busy.listing ? "拉取中..." : "拉取模型"}
          </button>
          <button className="button button-secondary" onClick={handleTest} disabled={busy.testing || !entry.browserSupported}>
            {busy.testing ? "测试中..." : "测试连接"}
          </button>
          <button className="button button-primary" onClick={handleSave} disabled={!entry.browserSupported || !fields.apiKey.trim()}>
            保存并应用
          </button>
        </div>

        {testResult ? (
          <div className={`settings-result ${testResult.success ? "success" : "error"}`}>{testResult.message}</div>
        ) : null}
      </div>
    </Modal>
  );
}

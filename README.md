# Novel Flow

一个适合轻量互动小说续写的纯前端静态应用，运行时基于 Vercel AI SDK。

## 已实现

- 作品列表、本地模板库、单页写作台
- OpenAI-compatible 模型配置
- Vercel AI SDK `ai` + `@ai-sdk/openai` + `@ai-sdk/openai-compatible`
- 继续 / 重写 / 从节点分叉
- IndexedDB 本地持久化
- 轻量分支树、当前分支时间线
- 自动摘要与手动摘要
- JSON 导入导出、Markdown 导出

## 使用

直接用静态服务器打开当前目录即可，例如：

```bash
python3 -m http.server 4173
```

然后访问 `http://localhost:4173`。

## 说明

- 这是纯前端版本，API Key 只保存在当前浏览器。
- 运行时通过浏览器模块加载 Vercel AI SDK，并使用 `createOpenAI` / `createOpenAICompatible` 发起请求。
- 兼容性推断：只要目标服务暴露 OpenAI-compatible 接口且允许浏览器侧 CORS，请求就能工作。
- 为了保证可静态部署，当前实现没有引入构建工具和服务端代理。

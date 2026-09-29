# Crypto 问答助手

练手项目:一个回答加密货币问题的 AI 聊天网站。

技术栈:Next.js 16 + Vercel AI SDK v7 + Vercel AI Gateway + 币安/Hyperliquid 实时行情。

## 前置准备

1. Node.js(本机已装 v24)
2. Vercel 账号,并在 AI Gateway 里配置一个上游模型 key(如 OpenAI)
3. 一个 AI Gateway API Key(在 Vercel 控制台 → AI Gateway 创建)

## 首次运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local,填入 AI_GATEWAY_API_KEY

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 即可。

## 说明

- `AI_MODEL` 用 `provider/model` 格式,例如 `openai/gpt-4o-mini`、`deepseek/deepseek-chat`。
- 部署到 Vercel 后无需本地 key(Vercel 自动鉴权)。
- 对话数据存在浏览器 localStorage(见 `lib/chat-store.ts`,接口已做成异步,将来换数据库只改这一个文件)。
- 需求清单见 `docs/requirements.md`。

## 已实现的能力

- 回答加密货币/区块链概念问题
- 实时行情(tool calling):
  - 最新价(币安)
  - 24h 行情:涨跌幅、成交量、最高/最低/开盘价(币安)
  - K 线 + 走势解读:方向、幅度、量能、涨跌根数(币安)
  - 资金费率(Hyperliquid,因币安合约接口美区受限)
- 多会话管理:侧边栏新建/切换/删除对话,本地持久化
- 双语界面(中/英切换)+ 回答语言跟随提问语言
- 安全护栏:只答 crypto、不构成投资建议、私钥红线、反越狱、反诈骗

## 项目结构

```
app/
  api/chat/route.ts   # 聊天接口 + 4 个行情工具 + 系统提示词
  page.tsx            # 聊天界面 + 侧边栏(双语)
  globals.css         # 样式
lib/
  chat-store.ts       # 数据层(localStorage,异步接口)
docs/                 # 需求文档、踩坑笔记(本地)
```

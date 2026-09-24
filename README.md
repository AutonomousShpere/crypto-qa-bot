# Crypto 问答助手

练手项目:一个回答加密货币问题的 AI 聊天网站。

技术栈:Next.js + Vercel AI SDK + Vercel AI Gateway + 币安实时行情。

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
- 需求清单见 `docs/requirements.md`。

## 已实现的能力

- 回答加密货币/区块链概念问题
- 实时行情(tool calling 接币安公开 API,无需 key):
  - `getPrice` 最新价
  - `getFundingRate` 合约资金费率
  - `getKlines` K 线(开高低收、成交量)
- 只回答 crypto,超范围温柔拒绝
- 免责声明(不构成投资建议)+ 数据来源标注

## 下一步(阶段③)

部署上线:推到 GitHub → 连接 Vercel → 得到公网网址。

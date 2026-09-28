import type { UIMessage } from "ai";

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

const STORAGE_KEY = "crypto-chat-conversations";

// ===== 对外接口 =====
// 全部异步。未来要换成跨设备数据库时,只需改下面的「内部实现」,
// 这些函数名和签名保持不变,页面(调用方)一行都不用改。

/** 读取所有会话(调用方自行排序) */
export async function listConversations(): Promise<Conversation[]> {
  return readAll();
}

/** 新增或更新一个会话(按 id) */
export async function upsertConversation(conv: Conversation): Promise<void> {
  const list = readAll();
  const i = list.findIndex((c) => c.id === conv.id);
  if (i >= 0) list[i] = conv;
  else list.push(conv);
  writeAll(list);
}

/** 删除一个会话 */
export async function deleteConversation(id: string): Promise<void> {
  writeAll(readAll().filter((c) => c.id !== id));
}

/** 生成新的会话 id */
export function newConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ===== 内部实现(当前:浏览器 localStorage)=====
// 未来换数据库时,只改这里,例如改成 fetch 调后端接口。

function readAll(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeAll(list: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 忽略存储失败(如隐私模式、配额满)
  }
}

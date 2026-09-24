import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crypto 问答助手",
  description: "一个回答加密货币问题的 AI 助手",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

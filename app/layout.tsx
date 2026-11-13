import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "任务管家",
  description: "把消息、通知与个人计划，整理成清晰的待办。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

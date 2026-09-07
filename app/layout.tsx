import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Growth Agent",
  description: "从目标与预算到实验归因、动态调仓和经营复盘的会员增长投资系统演示。",
  openGraph: {
    title: "Growth Agent",
    description: "用可信增量回报管理每一笔会员预算。",
    images: [{ url: "/og.png", width: 1748, height: 915 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Growth Agent",
    description: "用可信增量回报管理每一笔会员预算。",
    images: ["/og.png"],
  },
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

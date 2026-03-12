import type { Metadata } from "next";
import { type ReactNode } from "react";
import "./globals.css";
import Main from "./Main";
import { AntdRegistry } from "@ant-design/nextjs-registry";

export const metadata: Metadata = {
  title: "Videofy",
  description: "Generate videos from articles using AI with videofy",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <AntdRegistry>
      <Main>{children}</Main>
    </AntdRegistry>
  );
}

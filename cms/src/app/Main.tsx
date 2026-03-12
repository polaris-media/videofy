"use client";
import { StyleProvider } from "@ant-design/cssinjs";
import { App, ConfigProvider, Layout, theme } from "antd";
import type { ReactNode } from "react";

export default function Main({ children }: { children: ReactNode }) {
  return (
    <StyleProvider layer>
      <ConfigProvider
        wave={{ disabled: true }}
        theme={{
          hashed: false,
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#4f39f6",
            fontSize: 16,
            fontFamily: "Roboto Flex, sans, Helvetica, Arial",
            colorBgBase: "#131315",
            colorBgContainer: "#1a1a1d",
            colorBgElevated: "rgb(34,34,40)",
          },
          components: {
            TreeSelect: {
              indentSize: 12,
              controlItemBgHover: "rgba(0,0,0,0.09)",
            },
            Tabs: {
              colorPrimary: "oklch(0.673 0.182 276.935)",
              itemActiveColor: "white",
            },
          },
        }}
      >
        <html
          lang="en"
          style={{ height: "100%" }}
        >
          <body style={{ height: "100%", margin: 0 }}>
            <Layout style={{ minHeight: "100vh" }}>
              <App message={{ duration: 10 }}>{children}</App>
            </Layout>
          </body>
        </html>
      </ConfigProvider>
    </StyleProvider>
  );
}

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
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#1d4ed8",
            fontSize: 16,
            fontFamily: "Roboto Flex, sans, Helvetica, Arial",
            colorBgBase: "#f3f7fd",
            colorBgLayout: "#f3f7fd",
            colorBgContainer: "#ffffff",
            colorBgElevated: "#ffffff",
            colorBorder: "#d7e3f4",
            colorBorderSecondary: "#e5edf8",
            colorText: "#0f172a",
            colorTextSecondary: "#475569",
            borderRadius: 14,
          },
          components: {
            Layout: {
              bodyBg: "#f3f7fd",
              headerBg: "#ffffff",
              siderBg: "#ffffff",
              triggerBg: "#e8f0fb",
            },
            Card: {
              colorBgContainer: "#ffffff",
              colorBorderSecondary: "#dbe5f3",
            },
            Input: {
              colorBgContainer: "#ffffff",
              activeBorderColor: "#2563eb",
              hoverBorderColor: "#60a5fa",
            },
            Select: {
              colorBgContainer: "#ffffff",
              optionSelectedBg: "#dbeafe",
              optionActiveBg: "#eff6ff",
            },
            Button: {
              primaryShadow: "0 10px 24px rgba(37, 99, 235, 0.18)",
              defaultShadow: "none",
            },
            TreeSelect: {
              indentSize: 12,
              controlItemBgHover: "#eff6ff",
            },
            Tabs: {
              colorPrimary: "#1d4ed8",
              itemActiveColor: "#1d4ed8",
              itemColor: "#475569",
              itemHoverColor: "#1e40af",
            },
          },
        }}
      >
        <html
          lang="en"
          style={{ height: "100%", background: "#f3f7fd" }}
        >
          <body style={{ height: "100%", margin: 0, background: "#f3f7fd" }}>
            <Layout style={{ minHeight: "100vh", background: "#f3f7fd" }}>
              <App message={{ duration: 10 }}>{children}</App>
            </Layout>
          </body>
        </html>
      </ConfigProvider>
    </StyleProvider>
  );
}

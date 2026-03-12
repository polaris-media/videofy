"use server";

import { ApiConfig } from "@/api";

interface SaveConfigResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export async function saveConfig(configData: ApiConfig): Promise<SaveConfigResponse> {
  try {
    const response = await fetch("/api/configs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configData),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text };
    }

    return {
      success: true,
      message: "Config updated successfully.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save config";
    return { success: false, error: message };
  }
}

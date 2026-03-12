import { NextResponse } from "next/server";
import { listProjectIds } from "@/lib/projectFiles";

export async function GET() {
  try {
    const projects = await listProjectIds();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json({ projects: [] }, { status: 500 });
  }
}

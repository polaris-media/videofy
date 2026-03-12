import { NextResponse } from "next/server";
import { listBrands } from "@/lib/brands";

export async function GET() {
  try {
    const brands = await listBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    console.error("Failed to list brands:", error);
    return NextResponse.json({ brands: [] }, { status: 500 });
  }
}

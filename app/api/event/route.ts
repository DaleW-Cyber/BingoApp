import { NextResponse } from "next/server";
import { getWorkbook } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  const workbook = await getWorkbook();

  return NextResponse.json(workbook, {
    headers: {
      "Cache-Control": `public, s-maxage=${workbook.refreshSeconds}, stale-while-revalidate=${workbook.refreshSeconds}`
    }
  });
}

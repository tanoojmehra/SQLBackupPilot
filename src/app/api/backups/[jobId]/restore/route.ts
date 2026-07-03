import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { jobId } = await params;
  return NextResponse.json({ error: "Restore is not implemented yet.", jobId }, { status: 501 });
}

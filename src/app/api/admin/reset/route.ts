import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    { error: "Admin reset is disabled until a safe, audited reset workflow is implemented." },
    { status: 501 }
  );
}

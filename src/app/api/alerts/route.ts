import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { requireAdmin } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ alerts });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

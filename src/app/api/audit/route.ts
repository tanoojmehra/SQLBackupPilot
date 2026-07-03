import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { requireOwner } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const logs = await prisma.auditLog.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ logs });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

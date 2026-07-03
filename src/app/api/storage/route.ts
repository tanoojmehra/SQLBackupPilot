import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { requireAdmin } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const adapters = await prisma.storageAdapter.findMany({ orderBy: { createdAt: "desc" } });
    const adaptersWithStats = await Promise.all(
      adapters.map(async (adapter) => {
        const backupCount = await prisma.backupJob.count({ where: { storageId: adapter.id } });
        const backupSizes = await prisma.backupJob.findMany({
          where: { storageId: adapter.id, status: "SUCCESS", size: { not: null } },
          select: { size: true }
        });
        const totalBytes = backupSizes.reduce((sum, backup) => sum + (backup.size || 0), 0);
        return { ...adapter, backupCount, totalSize: formatFileSize(totalBytes), status: backupCount > 0 ? "connected" : "disconnected" };
      })
    );

    return NextResponse.json({ adapters: adaptersWithStats });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = Math.round(bytes / Math.pow(1024, i) * 100) / 100;
  return size + ' ' + sizes[i];
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const { name, type, config } = await req.json();
    if (!name || !type || !config) {
      return NextResponse.json({ error: "Missing required storage fields." }, { status: 400 });
    }
    const adapter = await prisma.storageAdapter.create({ data: { name, type, config } });
    return NextResponse.json({ adapter });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

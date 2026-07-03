import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { scheduler } from "@/lib/scheduler";
import { requireAdmin } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const schedules = await prisma.backupSchedule.findMany({
      include: { databases: { select: { id: true, name: true, type: true } } },
      orderBy: { id: "asc" },
    });
    
    const schedulesWithRealData = await Promise.all(
      schedules.map(async (schedule) => {
        const backupCount = await prisma.backupJob.count({ where: { database: { scheduleId: schedule.id } } });
        const lastBackupJob = await prisma.backupJob.findFirst({
          where: { database: { scheduleId: schedule.id } },
          orderBy: { startedAt: "desc" }
        });
        const lastRun = lastBackupJob?.startedAt?.toISOString() || null;
        const nextRunDate = schedule.enabled ? scheduler.getNextRun(schedule.cron) : null;
        const nextRun = nextRunDate?.toISOString() || null;
        return { ...schedule, databaseCount: schedule.databases.length, nextRun, lastRun, status: schedule.enabled ? 'active' : 'paused', backupCount };
      })
    );
    
    return NextResponse.json({ schedules: schedulesWithRealData });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const { name, cron, retention, enabled } = await req.json();
    
    if (!name || !cron || retention === undefined) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }
    if (!scheduler.validateCronExpression(cron)) {
      return NextResponse.json({ error: "Invalid cron expression." }, { status: 400 });
    }
    if (!Number.isInteger(Number(retention)) || Number(retention) < 1) {
      return NextResponse.json({ error: "Retention must be a positive number." }, { status: 400 });
    }
    
    const schedule = await prisma.backupSchedule.create({
      data: { name, cron, retention: Number(retention), enabled: enabled !== undefined ? enabled : true },
      include: { database: { select: { name: true, type: true } } }
    });

    await scheduler.refreshSchedule(schedule.id);
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("Schedule creation error:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

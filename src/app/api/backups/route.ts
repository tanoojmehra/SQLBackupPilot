import { NextRequest, NextResponse } from "next/server";
import { backupService } from "@/lib/backup-service";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const backups = await backupService.listBackups();
    return NextResponse.json({ jobs: backups });
  } catch (error) {
    console.error("Failed to fetch backups:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const { databaseId, storageId } = await req.json();
    
    if (!databaseId) {
      return NextResponse.json(
        { error: "Database ID is required." }, 
        { status: 400 }
      );
    }
    
    const result = await backupService.createBackup({ databaseId, storageId });
    
    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: "Backup created successfully",
        filePath: result.filePath,
        size: result.size
      });
    } else {
      return NextResponse.json(
        { error: result.error || "Backup failed" }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Backup creation error:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

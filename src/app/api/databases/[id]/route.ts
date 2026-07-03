import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { requireAdmin } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const { 
      name, 
      type, 
      host, 
      port, 
      username, 
      password, 
      backupEnabled, 
      scheduleId, 
      storageId 
    } = await req.json();
    
    const updateData: any = {
      name,
      type,
      host,
      port,
      username,
      backupEnabled: backupEnabled || false,
      scheduleId: scheduleId || null,
      storageId: storageId || null
    };
    
    if (password !== undefined && password !== '') {
      updateData.password = password;
    }
    
    const database = await prisma.database.update({
      where: { id: Number(id) },
      data: updateData,
    });

    const { password: _password, ...safeDatabase } = database;
    return NextResponse.json({ database: safeDatabase });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    await prisma.database.delete({
      where: { id: Number(id) },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

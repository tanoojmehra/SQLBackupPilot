import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwner } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const { email, role, password } = await req.json();
    const updateData: { email?: string; role?: "OWNER" | "ADMIN"; passwordHash?: string } = {};
    
    if (email) updateData.email = email;
    if (role) {
      if (!["OWNER", "ADMIN"].includes(role)) {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }
      updateData.role = role as "OWNER" | "ADMIN";
    }
    if (password) {
      updateData.passwordHash = await hashPassword(password);
    }
    
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: updateData,
      select: { id: true, email: true, role: true },
    });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const userId = Number(id);

    if (auth.user.id === userId) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
    }

    await prisma.user.delete({
      where: { id: userId },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
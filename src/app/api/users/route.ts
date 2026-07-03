import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwner } from "@/lib/api-auth";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const users = await prisma.user.findMany({
      select: { 
        id: true, 
        email: true, 
        role: true, 
        createdAt: true,
        updatedAt: true
      },
      orderBy: { id: "asc" },
    });

    const usersWithActivity = await Promise.all(
      users.map(async (user) => {
        const lastActivity = await prisma.auditLog.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" }
        });
        
        const lastLogin = lastActivity?.createdAt?.toISOString() || null;
        const status = lastLogin ? 'active' : 'pending';
        
        return {
          ...user,
          lastLogin,
          status
        };
      })
    );

    return NextResponse.json({ users: usersWithActivity });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const { email, password, role } = await req.json();
    if (!email || !password || !role) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }
    if (!["OWNER", "ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already exists." }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, role },
      select: { id: true, email: true, role: true },
    });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
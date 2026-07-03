import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Role } from "@/generated/prisma";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

export type ApiAuthUser = { id: number; email: string; role: Role };
export type ApiAuthResult = { ok: true; user: ApiAuthUser } | { ok: false; response: NextResponse };

export async function requireAuth(req: NextRequest): Promise<ApiAuthResult> {
  const token = req.cookies.get("sbp_session")?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: number };
    if (!decoded.userId) {
      return { ok: false, response: NextResponse.json({ error: "Invalid session" }, { status: 401 }) };
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return { ok: false, response: NextResponse.json({ error: "User not found" }, { status: 401 }) };
    }

    return { ok: true, user };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid or expired session" }, { status: 401 }) };
  }
}

export async function requireRole(req: NextRequest, allowedRoles: Role[]): Promise<ApiAuthResult> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth;
  if (!allowedRoles.includes(auth.user.role)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return auth;
}

export function requireOwner(req: NextRequest): Promise<ApiAuthResult> {
  return requireRole(req, ["OWNER"]);
}

export function requireAdmin(req: NextRequest): Promise<ApiAuthResult> {
  return requireRole(req, ["OWNER", "ADMIN"]);
}

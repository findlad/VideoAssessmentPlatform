import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/api/admin-auth";

export async function GET(request) {
  const adminUser = await requireAdminUser(request);

  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    admin: adminUser,
  });
}

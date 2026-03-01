import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const department = searchParams.get("department");
    const isActive = searchParams.get("isActive");

    const where: Record<string, unknown> = {};
    if (department) where.department = department;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      where.isActive = isActive === "true";
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        splitAllocations: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(employees);
  } catch (error) {
    console.error("Employees GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      department,
      pkrBaseSalary,
      usdSupplement,
      bankName,
      bankAccount,
      startDate,
      endDate,
      isActive,
      notes,
      splitAllocations,
    } = body;

    if (!name || !department || pkrBaseSalary === undefined || !startDate) {
      return NextResponse.json(
        { error: "Missing required fields: name, department, pkrBaseSalary, startDate" },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.create({
      data: {
        name,
        department,
        pkrBaseSalary,
        usdSupplement: usdSupplement ?? null,
        bankName: bankName ?? null,
        bankAccount: bankAccount ?? null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive ?? true,
        notes: notes ?? null,
        splitAllocations: splitAllocations
          ? {
              create: splitAllocations.map(
                (alloc: { department: string; percentage: number }) => ({
                  department: alloc.department,
                  percentage: alloc.percentage,
                })
              ),
            }
          : undefined,
      },
      include: {
        splitAllocations: true,
      },
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error("Employees POST error:", error);
    return NextResponse.json(
      { error: "Failed to create employee" },
      { status: 500 }
    );
  }
}

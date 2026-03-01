import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        splitAllocations: true,
      },
    });

    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(employee);
  } catch (error) {
    console.error("Employee GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch employee" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();

    const existing = await prisma.employee.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

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

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (department !== undefined) updateData.department = department;
    if (pkrBaseSalary !== undefined) updateData.pkrBaseSalary = pkrBaseSalary;
    if (usdSupplement !== undefined) updateData.usdSupplement = usdSupplement;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankAccount !== undefined) updateData.bankAccount = bankAccount;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (notes !== undefined) updateData.notes = notes;

    // If splitAllocations are provided, replace them
    if (splitAllocations !== undefined) {
      await prisma.employeeSplitAllocation.deleteMany({
        where: { employeeId: id },
      });

      if (splitAllocations && splitAllocations.length > 0) {
        await prisma.employeeSplitAllocation.createMany({
          data: splitAllocations.map(
            (alloc: { department: string; percentage: number }) => ({
              employeeId: id,
              department: alloc.department,
              percentage: alloc.percentage,
            })
          ),
        });
      }
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        splitAllocations: true,
      },
    });

    return NextResponse.json(employee);
  } catch (error) {
    console.error("Employee PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update employee" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const employee = await prisma.employee.findUnique({
      where: { id },
    });

    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    // Delete split allocations first
    await prisma.employeeSplitAllocation.deleteMany({
      where: { employeeId: id },
    });

    const deleted = await prisma.employee.delete({
      where: { id },
    });

    return NextResponse.json(deleted);
  } catch (error) {
    console.error("Employee DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete employee" },
      { status: 500 }
    );
  }
}

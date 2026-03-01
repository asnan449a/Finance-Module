import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            shortName: true,
            currency: true,
            bank: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(transaction);
  } catch (error) {
    console.error("Transaction GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transaction" },
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

    const existing = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    const {
      lineOfService,
      category,
      clientOrVendor,
      notes,
      status,
      matched,
      matchedToId,
    } = body;

    const updateData: Record<string, unknown> = {};
    if (lineOfService !== undefined) updateData.lineOfService = lineOfService;
    if (category !== undefined) updateData.category = category;
    if (clientOrVendor !== undefined) updateData.clientOrVendor = clientOrVendor;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;
    if (matched !== undefined) updateData.matched = matched;
    if (matchedToId !== undefined) updateData.matchedToId = matchedToId;

    const transaction = await prisma.transaction.update({
      where: { id },
      data: updateData,
      include: {
        account: {
          select: {
            id: true,
            name: true,
            shortName: true,
            currency: true,
            bank: true,
          },
        },
      },
    });

    // Record audit log when classifying
    if (
      existing.status === "UNCLASSIFIED" &&
      status === "CLASSIFIED"
    ) {
      await prisma.auditLog.create({
        data: {
          action: "CLASSIFY_TRANSACTION",
          entityType: "Transaction",
          entityId: id,
          oldValue: JSON.stringify({
            status: existing.status,
            lineOfService: existing.lineOfService,
            category: existing.category,
          }),
          newValue: JSON.stringify({
            status,
            lineOfService: lineOfService ?? existing.lineOfService,
            category: category ?? existing.category,
          }),
        },
      });
    }

    return NextResponse.json(transaction);
  } catch (error) {
    console.error("Transaction PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update transaction" },
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

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    const deleted = await prisma.transaction.delete({
      where: { id },
    });

    return NextResponse.json(deleted);
  } catch (error) {
    console.error("Transaction DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete transaction" },
      { status: 500 }
    );
  }
}

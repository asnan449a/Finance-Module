import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface ClassifyItem {
  id: string;
  lineOfService: string;
  category: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items } = body as { items: ClassifyItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Request body must contain a non-empty 'items' array of { id, lineOfService, category }" },
        { status: 400 }
      );
    }

    // Validate all IDs exist before updating
    const ids = items.map((item) => item.id);
    const existing = await prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, lineOfService: true, category: true },
    });

    const existingIds = new Set(existing.map((t) => t.id));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: `Transactions not found: ${missingIds.join(", ")}` },
        { status: 404 }
      );
    }

    // Update all in a transaction
    const results = await prisma.$transaction(
      items.map((item) =>
        prisma.transaction.update({
          where: { id: item.id },
          data: {
            lineOfService: item.lineOfService,
            category: item.category,
            status: "CLASSIFIED",
          },
        })
      )
    );

    // Create audit logs for each classification
    const auditLogs = items.map((item) => {
      const prev = existing.find((e) => e.id === item.id);
      return prisma.auditLog.create({
        data: {
          action: "BATCH_CLASSIFY_TRANSACTION",
          entityType: "Transaction",
          entityId: item.id,
          oldValue: JSON.stringify({
            status: prev?.status,
            lineOfService: prev?.lineOfService,
            category: prev?.category,
          }),
          newValue: JSON.stringify({
            status: "CLASSIFIED",
            lineOfService: item.lineOfService,
            category: item.category,
          }),
        },
      });
    });

    await prisma.$transaction(auditLogs);

    return NextResponse.json({
      classified: results.length,
      transactions: results,
    });
  } catch (error) {
    console.error("Batch classify error:", error);
    return NextResponse.json(
      { error: "Failed to batch classify transactions" },
      { status: 500 }
    );
  }
}

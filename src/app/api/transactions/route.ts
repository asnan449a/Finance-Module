import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyTransaction } from "@/lib/classify";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const lineOfService = searchParams.get("lineOfService");
    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const accountId = searchParams.get("accountId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const where: Record<string, unknown> = {};

    if (lineOfService) where.lineOfService = lineOfService;
    if (category) where.category = category;
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) (where.date as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.date as Record<string, unknown>).lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { description: { contains: search } },
        { clientOrVendor: { contains: search } },
        { notes: { contains: search } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
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
        orderBy: { date: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Transactions GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      date,
      accountId,
      amount,
      currency,
      amountPkr,
      direction,
      description,
      lineOfService,
      category,
      clientOrVendor,
      matched,
      matchedToId,
      notes,
      status,
      createdById,
    } = body;

    if (!date || !accountId || amount === undefined || !currency || amountPkr === undefined || !direction || !description) {
      return NextResponse.json(
        { error: "Missing required fields: date, accountId, amount, currency, amountPkr, direction, description" },
        { status: 400 }
      );
    }

    // Auto-classify using the classify function
    const classification = classifyTransaction(description);

    const transaction = await prisma.transaction.create({
      data: {
        date: new Date(date),
        accountId,
        amount,
        currency,
        amountPkr,
        direction,
        description,
        lineOfService: lineOfService ?? classification.lineOfService,
        category: category ?? classification.category,
        clientOrVendor: clientOrVendor ?? null,
        matched: matched ?? false,
        matchedToId: matchedToId ?? null,
        notes: notes ?? null,
        status: status ?? classification.status,
        createdById: createdById ?? null,
      },
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

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    console.error("Transactions POST error:", error);
    return NextResponse.json(
      { error: "Failed to create transaction" },
      { status: 500 }
    );
  }
}

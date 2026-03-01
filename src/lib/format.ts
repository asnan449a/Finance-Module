import { CURRENCY_SYMBOLS } from "./constants";

export function formatCurrency(amount: number, currency: string = "USD"): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const absAmount = Math.abs(amount);

  if (currency === "PKR") {
    if (absAmount >= 10000000) {
      return `${amount < 0 ? "-" : ""}${symbol}${(absAmount / 10000000).toFixed(2)}Cr`;
    }
    if (absAmount >= 100000) {
      return `${amount < 0 ? "-" : ""}${symbol}${(absAmount / 100000).toFixed(2)}L`;
    }
  }

  return `${amount < 0 ? "-" : ""}${symbol}${absAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCurrencyFull(amount: number, currency: string = "USD"): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${amount < 0 ? "-" : ""}${symbol}${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateShort(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

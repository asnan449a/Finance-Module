import { asMoney } from './fx.js';

function cloneRows(rows = []) {
  return rows.map((row) => ({ ...row }));
}

export function buildRelatedPartyEliminations(rows = []) {
  const dueFromRow = rows.find((row) => String(row.code || '') === '1200') || null;
  const dueToRow = rows.find((row) => String(row.code || '') === '2200') || null;
  const dueFrom = Math.max(Number(dueFromRow?.net || 0), 0);
  const dueTo = Math.max(Number(dueToRow?.net || 0), 0);
  const eliminationAmount = asMoney(Math.min(dueFrom, dueTo));

  return {
    eliminationAmount,
    dueFromBefore: asMoney(dueFrom),
    dueToBefore: asMoney(dueTo),
    dueFromAfter: asMoney(dueFrom - eliminationAmount),
    dueToAfter: asMoney(dueTo - eliminationAmount)
  };
}

export function applyRelatedPartyEliminations(trialBalance) {
  const rows = cloneRows(trialBalance.rows || []);
  const elimination = buildRelatedPartyEliminations(rows);
  if (elimination.eliminationAmount <= 0) {
    return {
      ...trialBalance,
      consolidatedRows: rows,
      eliminations: elimination
    };
  }

  const dueFromRow = rows.find((row) => String(row.code || '') === '1200');
  const dueToRow = rows.find((row) => String(row.code || '') === '2200');

  if (dueFromRow) {
    dueFromRow.credit = asMoney(Number(dueFromRow.credit || 0) + elimination.eliminationAmount);
    dueFromRow.net = asMoney(Math.max(Number(dueFromRow.net || 0) - elimination.eliminationAmount, 0));
  }

  if (dueToRow) {
    dueToRow.debit = asMoney(Number(dueToRow.debit || 0) + elimination.eliminationAmount);
    dueToRow.net = asMoney(Math.max(Number(dueToRow.net || 0) - elimination.eliminationAmount, 0));
  }

  return {
    ...trialBalance,
    rows,
    consolidatedRows: rows,
    eliminations: elimination,
    totals: {
      debit: asMoney(rows.reduce((sum, row) => sum + Number(row.debit || 0), 0)),
      credit: asMoney(rows.reduce((sum, row) => sum + Number(row.credit || 0), 0))
    }
  };
}


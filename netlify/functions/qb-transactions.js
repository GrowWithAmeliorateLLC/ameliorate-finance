// netlify/functions/qb-transactions.js
// Fetches expenses AND income from QuickBooks, including memo fields
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  try {
    const { accessToken, realmId, startDate, endDate } = JSON.parse(event.body);
    if (!accessToken || !realmId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing accessToken or realmId' }) };
    const start = startDate || new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];
    const isProduction = process.env.QB_ENV === 'production';
    const apiBase = isProduction
      ? `https://quickbooks.api.intuit.com/v3/company/${realmId}`
      : `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;
    const qbFetch = (query) => fetch(
      `${apiBase}/query?query=${encodeURIComponent(query)}&minorversion=65`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } }
    );
    const [purchaseRes, billRes, invoiceRes, paymentRes, salesReceiptRes, depositRes] = await Promise.all([
      qbFetch(`SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 500`),
      qbFetch(`SELECT * FROM Bill WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 200`),
      qbFetch(`SELECT * FROM Invoice WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 300`),
      qbFetch(`SELECT * FROM Payment WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 300`),
      qbFetch(`SELECT * FROM SalesReceipt WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 200`),
      qbFetch(`SELECT * FROM Deposit WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' MAXRESULTS 200`)
    ]);
    const [pd, bd, id, pyd, srd, dd] = await Promise.all([
      purchaseRes.json(), billRes.json(), invoiceRes.json(),
      paymentRes.json(), salesReceiptRes.json(), depositRes.json()
    ]);
    const purchases = (pd.QueryResponse?.Purchase || []).map(p => ({
      id: p.Id, date: p.TxnDate, type: 'Expense',
      payee: p.EntityRef?.name || 'Unknown',
      memo: p.PrivateNote || p.DocNumber || '',
      amount: -(p.TotalAmt || 0),
      account: p.AccountRef?.name || '',
      lines: (p.Line || []).map(l => ({
        description: l.Description || l.AccountBasedExpenseLineDetail?.AccountRef?.name || '',
        amount: -(l.Amount || 0),
        account: l.AccountBasedExpenseLineDetail?.AccountRef?.name || ''
      })).filter(l => l.amount !== 0)
    }));
    const bills = (bd.QueryResponse?.Bill || []).map(b => ({
      id: b.Id, date: b.TxnDate, type: 'Bill',
      payee: b.VendorRef?.name || 'Unknown Vendor',
      memo: b.PrivateNote || b.DocNumber || '',
      amount: -(b.TotalAmt || 0),
      account: 'Accounts Payable',
      lines: (b.Line || []).map(l => ({
        description: l.Description || '',
        amount: -(l.Amount || 0),
        account: l.AccountBasedExpenseLineDetail?.AccountRef?.name || ''
      })).filter(l => l.amount !== 0)
    }));
    const invoices = (id.QueryResponse?.Invoice || []).map(i => ({
      id: i.Id, date: i.TxnDate, type: 'Invoice',
      payee: i.CustomerRef?.name || 'Client',
      memo: i.PrivateNote || i.DocNumber || '',
      amount: +(i.TotalAmt || 0),
      account: 'Accounts Receivable', lines: []
    }));
    const payments = (pyd.QueryResponse?.Payment || []).map(p => ({
      id: p.Id, date: p.TxnDate, type: 'Payment Received',
      payee: p.CustomerRef?.name || 'Client',
      memo: p.PrivateNote || p.PaymentRefNum || '',
      amount: +(p.TotalAmt || 0),
      account: p.DepositToAccountRef?.name || 'Undeposited Funds', lines: []
    }));
    const salesReceipts = (srd.QueryResponse?.SalesReceipt || []).map(s => ({
      id: s.Id, date: s.TxnDate, type: 'Sales Receipt',
      payee: s.CustomerRef?.name || 'Client',
      memo: s.PrivateNote || s.DocNumber || '',
      amount: +(s.TotalAmt || 0),
      account: s.DepositToAccountRef?.name || '', lines: []
    }));
    const deposits = (dd.QueryResponse?.Deposit || []).map(d => ({
      id: d.Id, date: d.TxnDate, type: 'Deposit',
      payee: 'Deposit',
      memo: d.PrivateNote || '',
      amount: +(d.TotalAmt || 0),
      account: d.DepositToAccountRef?.name || '',
      lines: (d.Line || []).map(l => ({
        description: l.Description || l.DepositLineDetail?.Entity?.name || '',
        amount: +(l.Amount || 0),
        account: l.DepositLineDetail?.AccountRef?.name || ''
      })).filter(l => l.amount > 0)
    }));
    const transactions = [...purchases, ...bills, ...invoices, ...payments, ...salesReceipts, ...deposits]
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const totalIncome = [...invoices, ...payments, ...salesReceipts, ...deposits].reduce((s, t) => s + t.amount, 0);
    const totalExpenses = Math.abs([...purchases, ...bills].reduce((s, t) => s + t.amount, 0));
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        transactions, count: transactions.length,
        incomeCount: invoices.length + payments.length + salesReceipts.length + deposits.length,
        expenseCount: purchases.length + bills.length,
        summary: { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses },
        dateRange: { start, end }
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

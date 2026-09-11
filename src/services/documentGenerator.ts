import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import autoTable from 'jspdf-autotable';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;

  }
}

export interface BalanceSheetData {
  companyName: string;
  period: string;
  // Assets
  currentAssets: {
    cash: number;
    accountsReceivable: number;
    inventory: number;
    otherCurrentAssets: number;
  };
  nonCurrentAssets: {
    propertyPlantEquipment: number;
    intangibleAssets: number;
    investments: number;
    otherNonCurrentAssets: number;
  };
  // Liabilities
  currentLiabilities: {
    accountsPayable: number;
    shortTermDebt: number;
    accruedExpenses: number;
    otherCurrentLiabilities: number;
  };
  nonCurrentLiabilities: {
    longTermDebt: number;
    deferredTax: number;
    otherNonCurrentLiabilities: number;
  };
  // Equity
  equity: {
    shareCapital: number;
    retainedEarnings: number;
    otherEquity: number;
  };
}

export interface ProfitLossData {
  companyName: string;
  period: string;
  revenue: {
    sales: number;
    serviceRevenue: number;
    otherRevenue: number;
  };
  expenses: {
    costOfGoodsSold: number;
    salariesWages: number;
    rent: number;
    utilities: number;
    marketing: number;
    depreciation: number;
    otherExpenses: number;
  };
  otherIncome: {
    interestIncome: number;
    investmentGains: number;
    otherIncome: number;
  };
  tax: number;
}

export interface BankStatementData {
  companyName: string;
  accountNumber: string;
  period: string;
  openingBalance: number;
  transactions: {
    date: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  closingBalance: number;
}

export class DocumentGenerator {
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'ZAR',
    }).format(amount);
  }

  private formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-GB');
  }

  // Generate Balance Sheet PDF
  generateBalanceSheetPDF(data: BalanceSheetData): void {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text('BALANCE SHEET', 105, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.text(data.companyName, 105, 30, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Period: ${data.period}`, 105, 40, { align: 'center' });

    let yPosition = 60;

    // Calculate totals
    const totalCurrentAssets = Object.values(data.currentAssets).reduce((a, b) => a + b, 0);
    const totalNonCurrentAssets = Object.values(data.nonCurrentAssets).reduce((a, b) => a + b, 0);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

    const totalCurrentLiabilities = Object.values(data.currentLiabilities).reduce((a, b) => a + b, 0);
    const totalNonCurrentLiabilities = Object.values(data.nonCurrentLiabilities).reduce((a, b) => a + b, 0);
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

    const totalEquity = Object.values(data.equity).reduce((a, b) => a + b, 0);

    // Assets Section
    autoTable(doc, {
      startY: yPosition,
      head: [['ASSETS', 'R']],
      body: [
        ['Current Assets', ''],
        ['  Cash and Cash Equivalents', this.formatCurrency(data.currentAssets.cash)],
        ['  Accounts Receivable', this.formatCurrency(data.currentAssets.accountsReceivable)],
        ['  Inventory', this.formatCurrency(data.currentAssets.inventory)],
        ['  Other Current Assets', this.formatCurrency(data.currentAssets.otherCurrentAssets)],
        ['Total Current Assets', this.formatCurrency(totalCurrentAssets)],
        ['', ''],
        ['Non-Current Assets', ''],
        ['  Property, Plant & Equipment', this.formatCurrency(data.nonCurrentAssets.propertyPlantEquipment)],
        ['  Intangible Assets', this.formatCurrency(data.nonCurrentAssets.intangibleAssets)],
        ['  Investments', this.formatCurrency(data.nonCurrentAssets.investments)],
        ['  Other Non-Current Assets', this.formatCurrency(data.nonCurrentAssets.otherNonCurrentAssets)],
        ['Total Non-Current Assets', this.formatCurrency(totalNonCurrentAssets)],
        ['', ''],
        ['TOTAL ASSETS', this.formatCurrency(totalAssets)]
      ],
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 60, halign: 'right' }
      }
    });

    yPosition = (doc as any).lastAutoTable.finalY + 20;

    // Liabilities and Equity Section
    autoTable(doc, {
      startY: yPosition,
      head: [['LIABILITIES AND EQUITY', 'R']],
      body: [
        ['Current Liabilities', ''],
        ['  Accounts Payable', this.formatCurrency(data.currentLiabilities.accountsPayable)],
        ['  Short-term Debt', this.formatCurrency(data.currentLiabilities.shortTermDebt)],
        ['  Accrued Expenses', this.formatCurrency(data.currentLiabilities.accruedExpenses)],
        ['  Other Current Liabilities', this.formatCurrency(data.currentLiabilities.otherCurrentLiabilities)],
        ['Total Current Liabilities', this.formatCurrency(totalCurrentLiabilities)],
        ['', ''],
        ['Non-Current Liabilities', ''],
        ['  Long-term Debt', this.formatCurrency(data.nonCurrentLiabilities.longTermDebt)],
        ['  Deferred Tax Liabilities', this.formatCurrency(data.nonCurrentLiabilities.deferredTax)],
        ['  Other Non-Current Liabilities', this.formatCurrency(data.nonCurrentLiabilities.otherNonCurrentLiabilities)],
        ['Total Non-Current Liabilities', this.formatCurrency(totalNonCurrentLiabilities)],
        ['Total Liabilities', this.formatCurrency(totalLiabilities)],
        ['', ''],
        ['Equity', ''],
        ['  Share Capital', this.formatCurrency(data.equity.shareCapital)],
        ['  Retained Earnings', this.formatCurrency(data.equity.retainedEarnings)],
        ['  Other Equity', this.formatCurrency(data.equity.otherEquity)],
        ['Total Equity', this.formatCurrency(totalEquity)],
        ['', ''],
        ['TOTAL LIABILITIES AND EQUITY', this.formatCurrency(totalLiabilities + totalEquity)]
      ],
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 60, halign: 'right' }
      }
    });

    doc.save(`balance-sheet-${data.companyName.replace(/\s+/g, '-')}-${data.period}.pdf`);
  }

  // Generate Profit & Loss PDF
  generateProfitLossPDF(data: ProfitLossData): void {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text('PROFIT & LOSS STATEMENT', 105, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.text(data.companyName, 105, 30, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Period: ${data.period}`, 105, 40, { align: 'center' });

    // Calculate totals
    const totalRevenue = Object.values(data.revenue).reduce((a, b) => a + b, 0);
    const totalExpenses = Object.values(data.expenses).reduce((a, b) => a + b, 0);
    const totalOtherIncome = Object.values(data.otherIncome).reduce((a, b) => a + b, 0);
    const grossProfit = totalRevenue - data.expenses.costOfGoodsSold;
    const operatingProfit = grossProfit - (totalExpenses - data.expenses.costOfGoodsSold);
    const profitBeforeTax = operatingProfit + totalOtherIncome;
    const netProfit = profitBeforeTax - data.tax;

    autoTable(doc, {
      startY: 60,
      head: [['PROFIT & LOSS STATEMENT', 'R']],
      body: [
        ['Revenue', ''],
        ['  Sales Revenue', this.formatCurrency(data.revenue.sales)],
        ['  Service Revenue', this.formatCurrency(data.revenue.serviceRevenue)],
        ['  Other Revenue', this.formatCurrency(data.revenue.otherRevenue)],
        ['Total Revenue', this.formatCurrency(totalRevenue)],
        ['', ''],
        ['Cost of Goods Sold', this.formatCurrency(data.expenses.costOfGoodsSold)],
        ['Gross Profit', this.formatCurrency(grossProfit)],
        ['', ''],
        ['Operating Expenses', ''],
        ['  Salaries and Wages', this.formatCurrency(data.expenses.salariesWages)],
        ['  Rent', this.formatCurrency(data.expenses.rent)],
        ['  Utilities', this.formatCurrency(data.expenses.utilities)],
        ['  Marketing', this.formatCurrency(data.expenses.marketing)],
        ['  Depreciation', this.formatCurrency(data.expenses.depreciation)],
        ['  Other Expenses', this.formatCurrency(data.expenses.otherExpenses)],
        ['Total Operating Expenses', this.formatCurrency(totalExpenses - data.expenses.costOfGoodsSold)],
        ['Operating Profit', this.formatCurrency(operatingProfit)],
        ['', ''],
        ['Other Income', ''],
        ['  Interest Income', this.formatCurrency(data.otherIncome.interestIncome)],
        ['  Investment Gains', this.formatCurrency(data.otherIncome.investmentGains)],
        ['  Other Income', this.formatCurrency(data.otherIncome.otherIncome)],
        ['Total Other Income', this.formatCurrency(totalOtherIncome)],
        ['', ''],
        ['Profit Before Tax', this.formatCurrency(profitBeforeTax)],
        ['Tax Expense', this.formatCurrency(data.tax)],
        ['NET PROFIT', this.formatCurrency(netProfit)]
      ],
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [66, 139, 202] },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 60, halign: 'right' }
      }
    });

    doc.save(`profit-loss-${data.companyName.replace(/\s+/g, '-')}-${data.period}.pdf`);
  }

  // Generate Bank Statement Excel
  generateBankStatementExcel(data: BankStatementData): void {
    const workbook = XLSX.utils.book_new();

    // Create header data
    const headerData = [
      ['BANK STATEMENT'],
      [data.companyName],
      [`Account: ${data.accountNumber}`],
      [`Period: ${data.period}`],
      [''],
      ['Opening Balance', this.formatCurrency(data.openingBalance)],
      [''],
      ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance']
    ];

    // Add transaction data
    const transactionData = data.transactions.map(tx => [
      this.formatDate(tx.date),
      tx.description,
      tx.reference,
      tx.debit ? this.formatCurrency(tx.debit) : '',
      tx.credit ? this.formatCurrency(tx.credit) : '',
      this.formatCurrency(tx.balance)
    ]);

    // Add closing balance
    const footerData = [
      [''],
      ['Closing Balance', this.formatCurrency(data.closingBalance)],
      [''],
      ['Total Debits', this.formatCurrency(data.transactions.reduce((sum, tx) => sum + tx.debit, 0))],
      ['Total Credits', this.formatCurrency(data.transactions.reduce((sum, tx) => sum + tx.credit, 0))]
    ];

    // Combine all data
    const worksheetData = [...headerData, ...transactionData, ...footerData];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet['!cols'] = [
      { width: 12 },  // Date
      { width: 30 },  // Description
      { width: 15 },  // Reference
      { width: 12 },  // Debit
      { width: 12 },  // Credit
      { width: 15 }   // Balance
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bank Statement');
    XLSX.writeFile(workbook, `bank-statement-${data.companyName.replace(/\s+/g, '-')}-${data.period}.xlsx`);
  }

  // Generate Management Accounts PDF (Comprehensive Report)
  generateManagementAccountsPDF(balanceSheet: BalanceSheetData, profitLoss: ProfitLossData): void {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text('MANAGEMENT ACCOUNTS', 105, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.text(balanceSheet.companyName, 105, 30, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Period: ${balanceSheet.period}`, 105, 40, { align: 'center' });

    // Executive Summary
    const totalRevenue = Object.values(profitLoss.revenue).reduce((a, b) => a + b, 0);
    const totalAssets = Object.values(balanceSheet.currentAssets).reduce((a, b) => a + b, 0) +
                       Object.values(balanceSheet.nonCurrentAssets).reduce((a, b) => a + b, 0);
    const netProfit = totalRevenue - Object.values(profitLoss.expenses).reduce((a, b) => a + b, 0) - profitLoss.tax;

    autoTable(doc,{
      startY: 60,
      head: [['EXECUTIVE SUMMARY', 'Amount']],
      body: [
        ['Total Revenue', this.formatCurrency(totalRevenue)],
        ['Net Profit', this.formatCurrency(netProfit)],
        ['Total Assets', this.formatCurrency(totalAssets)],
        ['Profit Margin', `${((netProfit / totalRevenue) * 100).toFixed(2)}%`],
        ['Return on Assets', `${((netProfit / totalAssets) * 100).toFixed(2)}%`]
      ],
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [66, 139, 202] }
    });

    // Add new page for detailed P&L
    doc.addPage();
    doc.setFontSize(16);
    doc.text('PROFIT & LOSS ANALYSIS', 105, 20, { align: 'center' });

    // Detailed P&L would continue here...
    // This is a simplified version for demo purposes

    doc.save(`management-accounts-${balanceSheet.companyName.replace(/\s+/g, '-')}-${balanceSheet.period}.pdf`);
  }
}

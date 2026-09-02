// Shared PDF render types — safe to import in both server and browser code.
// The theme is the only user-set knob (font + accent color); everything else
// about a document's appearance is decided by the layout function it's routed
// to (see $lib/server/pdf/layouts/).

export type ThemeData = {
  color: string;
  font: number;
};

export type LayoutLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type LayoutRenderData = {
  document: {
    invoiceNumber?: string;
    quotationNumber?: string;
    issueDate: string | null;
    dueDate?: string | null;
    expiryDate?: string | null;
    reference?: string | null;
    currency: string;
    lines: LayoutLineItem[];
    subtotal: number;
    taxAmount: number;
    total: number;
    notes?: string | null;
    terms?: string | null;
    contactName?: string | null;
    contactAddress?: string | null;
    contactRegistrationNo?: string | null;
    contactPhone?: string | null;
    paidMinor?: number;
    outstandingMinor?: number;
    paid?: boolean;
    isOverdue?: boolean;
    settlements?: { amountMinor: number; createdAt: string }[];
  };
  settings: {
    companyName?: string;
    companyAddress?: string;
    companyRegistrationNo?: string;
    companyLogoPath?: string;
  };
  docTypeLabel: string;
};

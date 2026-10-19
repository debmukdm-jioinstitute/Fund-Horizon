// Operations forms registry and schema definitions.
// Covers CAMS, KFintech (Carvy), and Stallion Asset PMS across all required categories.

export type FormRepository = "CAMS" | "Carvy" | "Stallion";
export type FormCategory = "new_client" | "mutual_fund" | "pms_stallion" | "old_client";

export interface FormFieldDefinition {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "textarea" | "checkbox";
  placeholder?: string;
  options?: string[];
  required?: boolean;
  helpText?: string;
  defaultValue?: string | boolean | number;
}

export interface OperationFormTemplate {
  id: string;
  title: string;
  repository: FormRepository;
  category: FormCategory;
  formCode: string;
  version: string;
  description: string;
  badge: string;
  isAutomated: boolean;
  defaultAmc?: string;
  defaultScheme?: string;
  specificFields: FormFieldDefinition[];
  declarations: string[];
}

export const FORM_CATEGORIES: Array<{ id: FormCategory; label: string; count?: number; icon: string }> = [
  { id: "new_client", label: "New Client", icon: "👤" },
  { id: "mutual_fund", label: "Mutual Fund", icon: "📈" },
  { id: "pms_stallion", label: "PMS (Stallion)", icon: "🏛️" },
  { id: "old_client", label: "Old Client (Service)", icon: "🔄" },
];

export const OPERATIONS_FORMS: OperationFormTemplate[] = [
  // --- NEW CLIENT FORMS ---
  {
    id: "cams_account_opening",
    title: "CAMS Common Account Opening Form",
    repository: "CAMS",
    category: "new_client",
    formCode: "CAMS-AOF-2026",
    version: "v2026.1",
    description: "New investor account opening with CKYC, FATCA and primary bank mandate setup.",
    badge: "Official RTA Form",
    isAutomated: true,
    defaultAmc: "HDFC Mutual Fund",
    specificFields: [
      { id: "holding_nature", label: "Holding Nature", type: "select", options: ["Single", "Anyone or Survivor", "Joint"], required: true, defaultValue: "Single" },
      { id: "occupation", label: "Occupation", type: "select", options: ["Private Sector", "Public Sector", "Business", "Professional", "Retired", "Student"], required: true, defaultValue: "Private Sector" },
      { id: "gross_annual_income", label: "Gross Annual Income", type: "select", options: ["Below 1 Lac", "1-5 Lacs", "5-10 Lacs", "10-25 Lacs", "25 Lacs - 1 Crore", "> 1 Crore"], required: true, defaultValue: "10-25 Lacs" },
      { id: "politically_exposed", label: "PEP Status", type: "select", options: ["Not Applicable", "Politically Exposed Person", "Related to PEP"], required: true, defaultValue: "Not Applicable" },
      { id: "initial_amount", label: "Initial Investment Amount (₹)", type: "number", placeholder: "e.g. 50000", required: true, defaultValue: "50000" },
      { id: "bank_name", label: "Primary Bank Name", type: "text", placeholder: "e.g. HDFC Bank", required: true, defaultValue: "HDFC Bank Ltd" },
      { id: "account_number", label: "Bank Account Number", type: "text", placeholder: "e.g. 50100234567890", required: true, defaultValue: "50100234567890" },
      { id: "ifsc_code", label: "Bank IFSC Code", type: "text", placeholder: "e.g. HDFC0000123", required: true, defaultValue: "HDFC0000123" },
      { id: "nominee_name", label: "Nominee Name", type: "text", placeholder: "Nominee Full Name", defaultValue: "Nominee Name" },
      { id: "nominee_relationship", label: "Nominee Relationship", type: "text", placeholder: "e.g. Spouse / Son / Daughter", defaultValue: "Spouse" },
    ],
    declarations: [
      "I/We have read and understood the Scheme Information Document and Statement of Additional Information.",
      "I/We confirm that Fund Horizon (ARN 345439) is authorized as distributor.",
      "I/We confirm that funds invested are through legitimate banking sources.",
    ],
  },
  {
    id: "kfin_account_opening",
    title: "KFintech (Carvy) Account Opening Form",
    repository: "Carvy",
    category: "new_client",
    formCode: "KFIN-AOF-2026",
    version: "v2026.1",
    description: "KFintech unified investor onboarding application for Nippon, UTI, Mirae, Axis, and Motilal AMC.",
    badge: "Official RTA Form",
    isAutomated: true,
    defaultAmc: "Nippon India Mutual Fund",
    specificFields: [
      { id: "holding_nature", label: "Holding Nature", type: "select", options: ["Single", "Anyone or Survivor", "Joint"], required: true, defaultValue: "Single" },
      { id: "occupation", label: "Occupation", type: "select", options: ["Private Sector", "Public Sector", "Business", "Professional", "Retired"], required: true, defaultValue: "Business" },
      { id: "gross_annual_income", label: "Gross Annual Income", type: "select", options: ["Below 1 Lac", "1-5 Lacs", "5-10 Lacs", "10-25 Lacs", "25 Lacs - 1 Crore", "> 1 Crore"], required: true, defaultValue: "25 Lacs - 1 Crore" },
      { id: "initial_amount", label: "Initial Investment Amount (₹)", type: "number", placeholder: "e.g. 100000", required: true, defaultValue: "100000" },
      { id: "bank_name", label: "Primary Bank Name", type: "text", placeholder: "e.g. ICICI Bank", required: true, defaultValue: "ICICI Bank" },
      { id: "account_number", label: "Bank Account Number", type: "text", placeholder: "e.g. 000401567890", required: true, defaultValue: "000401567890" },
      { id: "ifsc_code", label: "Bank IFSC Code", type: "text", placeholder: "e.g. ICIC0000004", required: true, defaultValue: "ICIC0000004" },
      { id: "nominee_name", label: "Nominee Name", type: "text", placeholder: "Nominee Full Name", defaultValue: "Nominee Name" },
    ],
    declarations: [
      "I/We declare that information provided in this KFintech application is true and complete.",
      "Distributor ARN 345439 is recorded for regular servicing.",
    ],
  },
  {
    id: "service_query_form",
    title: "New Client Service Query & Onboarding Request",
    repository: "CAMS",
    category: "new_client",
    formCode: "CAMS-NCSQ-01",
    version: "v2026.1",
    description: "Pre-onboarding service inquiry, portfolio transition guidance, and document verification ticket.",
    badge: "Operations Ticket",
    isAutomated: true,
    specificFields: [
      { id: "query_type", label: "Inquiry Nature", type: "select", options: ["KYC Verification Support", "Existing Folio Mapping to ARN 345439", "FATCA/CRS Discrepancy", "NRI Bank Mandate Query", "Demat to Physical Conversion"], required: true, defaultValue: "Existing Folio Mapping to ARN 345439" },
      { id: "urgency", label: "Priority Level", type: "select", options: ["Standard (48 hrs)", "High (Same Day)", "Immediate Regulatory"], defaultValue: "Standard (48 hrs)" },
      { id: "notes", label: "Specific Investor Requirements", type: "textarea", placeholder: "Describe folios, existing AMCs, or onboarding queries...", defaultValue: "Client requests mapping existing folios under ARN 345439 for consolidated reporting." },
    ],
    declarations: [
      "Verification request submitted under AMFI Distributor code ARN 345439.",
    ],
  },
  {
    id: "ckyc_individual_form",
    title: "CKYC & KRA Individual Application Form",
    repository: "CAMS",
    category: "new_client",
    formCode: "CAMS-CKYC-02",
    version: "v2026.1",
    description: "Central KYC registry form with identity, proof of address, and biometric verification link.",
    badge: "Official CKYC",
    isAutomated: true,
    specificFields: [
      { id: "identity_proof_type", label: "Identity Proof Type", type: "select", options: ["Aadhaar", "Passport", "Voter ID", "Driving License"], required: true, defaultValue: "Aadhaar" },
      { id: "identity_proof_no", label: "Identity Proof Number (Masked)", type: "text", placeholder: "XXXX-XXXX-1234", required: true, defaultValue: "XXXX-XXXX-8921" },
      { id: "address_proof_type", label: "Address Proof Type", type: "select", options: ["Aadhaar", "Passport", "Utility Bill", "Bank Statement"], required: true, defaultValue: "Aadhaar" },
      { id: "father_name", label: "Father's Full Name", type: "text", placeholder: "Father's Name", required: true, defaultValue: "Suresh Kumar" },
      { id: "mother_name", label: "Mother's Maiden Name", type: "text", placeholder: "Mother's Name", required: true, defaultValue: "Kamla Devi" },
    ],
    declarations: [
      "I hereby give my consent to verify my KYC records with CERSAI / CKYC registry.",
    ],
  },
  {
    id: "fatca_crs_declaration",
    title: "FATCA & CRS Supplementary Declaration Form",
    repository: "Carvy",
    category: "new_client",
    formCode: "KFIN-FATCA-03",
    version: "v2026.1",
    description: "Foreign Account Tax Compliance Act and Common Reporting Standard tax residency certification.",
    badge: "Statutory Tax Form",
    isAutomated: true,
    specificFields: [
      { id: "country_of_birth", label: "Country of Birth", type: "text", defaultValue: "India", required: true },
      { id: "citizenship", label: "Country of Citizenship", type: "text", defaultValue: "India", required: true },
      { id: "tax_resident_other", label: "Tax Resident of Any Country other than India?", type: "select", options: ["No (India Only)", "Yes"], required: true, defaultValue: "No (India Only)" },
      { id: "tax_id_number", label: "TIN / Tax Identification Number (if applicable)", type: "text", placeholder: "TIN / SSN", defaultValue: "N/A" },
    ],
    declarations: [
      "I certify that the information provided regarding tax residency is accurate and complete under PMLA/CBDT guidelines.",
    ],
  },

  // --- MUTUAL FUND FORMS ---
  {
    id: "cams_common_tx",
    title: "CAMS Common Transaction Slip",
    repository: "CAMS",
    category: "mutual_fund",
    formCode: "CAMS-CTS-2026",
    version: "v2026.2",
    description: "Standard transaction slip for Additional Purchase, Switch, SIP, and Redemption across CAMS AMCs.",
    badge: "Live RTA Form",
    isAutomated: true,
    defaultAmc: "ICICI Prudential Mutual Fund",
    defaultScheme: "ICICI Prudential Bluechip Fund - Growth",
    specificFields: [
      { id: "transaction_type", label: "Transaction Type", type: "select", options: ["Additional Purchase", "Switch Out / In", "Redemption", "SIP Registration"], required: true, defaultValue: "Additional Purchase" },
      { id: "amount_inr", label: "Transaction Amount (₹)", type: "number", placeholder: "e.g. 25000", defaultValue: "25000" },
      { id: "units", label: "Units (if Redemption/Switch)", type: "text", placeholder: "e.g. All Units or number", defaultValue: "All Available Units" },
      { id: "target_scheme", label: "Target Scheme (if Switch)", type: "text", placeholder: "Target Scheme Name", defaultValue: "N/A" },
      { id: "payment_mode", label: "Payment / Settlement Mode", type: "select", options: ["Net Banking", "UPI", "NEFT / RTGS", "Direct Debit Mandate", "Cheque"], defaultValue: "Net Banking" },
    ],
    declarations: [
      "Transaction processed under ARN 345439.",
      "Applicable NAV will depend on cut-off timing and funds realization under SEBI rules.",
    ],
  },
  {
    id: "kfin_common_tx",
    title: "KFintech (Carvy) Common Transaction Slip",
    repository: "Carvy",
    category: "mutual_fund",
    formCode: "KFIN-CTS-2026",
    version: "v2026.2",
    description: "Unified slip for additional investments, systematic transfers, or redemption for KFin serviced funds.",
    badge: "Live RTA Form",
    isAutomated: true,
    defaultAmc: "Nippon India Mutual Fund",
    defaultScheme: "Nippon India Large Cap Fund - Growth",
    specificFields: [
      { id: "transaction_type", label: "Transaction Type", type: "select", options: ["Additional Purchase", "Switch", "Redemption", "SIP New"], required: true, defaultValue: "Additional Purchase" },
      { id: "amount_inr", label: "Transaction Amount (₹)", type: "number", placeholder: "e.g. 50000", defaultValue: "50000" },
      { id: "payment_mode", label: "Payment Mode", type: "select", options: ["Direct Debit / OTM", "Net Banking", "NEFT"], defaultValue: "Direct Debit / OTM" },
    ],
    declarations: [
      "Authorizing KFintech to process transaction against Folio and debit verified bank account.",
    ],
  },
  {
    id: "sip_swp_stp_form",
    title: "SIP / STP / SWP Registration & Modification Form",
    repository: "CAMS",
    category: "mutual_fund",
    formCode: "CAMS-SIP-04",
    version: "v2026.1",
    description: "Setup new Systematic Investment Plan, Systematic Withdrawal, or Systematic Transfer facility.",
    badge: "Automated NACH",
    isAutomated: true,
    defaultAmc: "HDFC Mutual Fund",
    specificFields: [
      { id: "facility_type", label: "Facility Type", type: "select", options: ["New SIP Registration", "SIP Cancellation", "STP Registration", "SWP Cash Flow"], required: true, defaultValue: "New SIP Registration" },
      { id: "installment_amount", label: "Monthly Installment (₹)", type: "number", placeholder: "e.g. 10000", required: true, defaultValue: "10000" },
      { id: "frequency", label: "Frequency", type: "select", options: ["Monthly", "Quarterly", "Weekly"], defaultValue: "Monthly" },
      { id: "sip_date", label: "SIP Debit Date", type: "select", options: ["1st", "5th", "10th", "15th", "20th", "25th"], defaultValue: "10th" },
      { id: "tenure_period", label: "Tenure", type: "select", options: ["Until Cancelled (Perpetual)", "3 Years", "5 Years", "10 Years"], defaultValue: "Until Cancelled (Perpetual)" },
      { id: "otm_umrn", label: "OTM / UMRN Mandate Number", type: "text", placeholder: "UMRN or New Mandate", defaultValue: "NEW MANDATE ENCLOSED" },
    ],
    declarations: [
      "I authorize the AMC/RTA to debit my bank account on the chosen dates until written cancellation.",
    ],
  },
  {
    id: "nomination_registration_form",
    title: "Nomination Registration / Modification Form (Form 1)",
    repository: "CAMS",
    category: "mutual_fund",
    formCode: "AMFI-NOM-01",
    version: "v2026.1",
    description: "SEBI mandated nomination registration, percentage allocation, and guardian details for folios.",
    badge: "SEBI Mandated",
    isAutomated: true,
    specificFields: [
      { id: "nominee_1_name", label: "Nominee 1 Name", type: "text", required: true, defaultValue: "Pooja Kumar" },
      { id: "nominee_1_relation", label: "Relationship with Investor", type: "text", required: true, defaultValue: "Spouse" },
      { id: "nominee_1_share", label: "Nominee 1 Share (%)", type: "number", required: true, defaultValue: "100" },
      { id: "nominee_1_dob", label: "Nominee 1 Date of Birth", type: "date", defaultValue: "1988-06-20" },
      { id: "nominee_1_pan", label: "Nominee 1 PAN / Aadhaar (Masked)", type: "text", defaultValue: "ABCDE5678K" },
    ],
    declarations: [
      "I/We nominate the individual above to receive all units credited in my folio upon demise.",
    ],
  },
  {
    id: "arn_change_transfer",
    title: "Change of Broker / ARN Distributor Transfer Form",
    repository: "CAMS",
    category: "mutual_fund",
    formCode: "AMFI-ARN-TRANS",
    version: "v2026.1",
    description: "Transfer existing folios to Fund Horizon (ARN 345439) for continuous portfolio oversight.",
    badge: "Direct to ARN 345439",
    isAutomated: true,
    specificFields: [
      { id: "existing_broker_code", label: "Existing Broker / ARN Code", type: "text", placeholder: "e.g. ARN-0000 or Direct", defaultValue: "ARN-112233" },
      { id: "new_broker_code", label: "New Broker Code", type: "text", defaultValue: "ARN-345439 (Fund Horizon)", required: true },
      { id: "new_euin", label: "EUIN Code", type: "text", defaultValue: "E482910", required: true },
      { id: "transfer_reason", label: "Reason for Distributor Change", type: "select", options: ["Consolidated Portfolio Management", "Better Research & Analytics", "Service Relocation"], defaultValue: "Consolidated Portfolio Management" },
    ],
    declarations: [
      "I request the AMC to update the distributor code in all folios mentioned above to ARN 345439.",
    ],
  },
  {
    id: "folio_consolidation_form",
    title: "Consolidation of Multiple Folios Request Form",
    repository: "Carvy",
    category: "mutual_fund",
    formCode: "KFIN-FOL-CON",
    version: "v2026.1",
    description: "Merge duplicate folios under same PAN and identical holding pattern into one master folio.",
    badge: "Folio Hygiene",
    isAutomated: true,
    defaultAmc: "UTI Mutual Fund",
    specificFields: [
      { id: "target_master_folio", label: "Target Master Folio to Retain", type: "text", placeholder: "e.g. 19283746", required: true, defaultValue: "19283746/01" },
      { id: "folios_to_merge", label: "Folio Numbers to be Merged", type: "text", placeholder: "e.g. 18273645, 17263544", required: true, defaultValue: "18273645/02, 17263544/03" },
      { id: "holding_verification", label: "Confirmed Same Name & PAN in all Folios", type: "checkbox", defaultValue: true },
    ],
    declarations: [
      "I/We confirm holding pattern, PAN, and tax status are identical across all folios requested for merger.",
    ],
  },

  // --- PMS (STALLION ASSET FOCUS) ---
  {
    id: "stallion_onboarding",
    title: "Stallion Asset Core PMS Account Opening Kit",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-PMS-AOF",
    version: "v2026.1",
    description: "Discretionary PMS onboarding kit for Stallion Asset Core & Multi-Cap Investment Strategies.",
    badge: "Stallion PMS Official",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    defaultScheme: "Stallion Asset Core Fund (Multi-Cap Equity PMS)",
    specificFields: [
      { id: "pms_strategy", label: "Investment Strategy", type: "select", options: ["Stallion Core Strategy (Multi-Cap)", "Stallion Micro & Mid-Cap Alpha", "Stallion Tactical Dynamic"], required: true, defaultValue: "Stallion Core Strategy (Multi-Cap)" },
      { id: "commitment_amount", label: "Investment Commitment (Min ₹50 Lacs SEBI Mandate)", type: "number", placeholder: "e.g. 5000000", required: true, defaultValue: "5000000" },
      { id: "custody_bank", label: "Custody & Fund Accounting Partner", type: "select", options: ["HDFC Bank Custody", "Axis Bank Custody", "Kotak Custody"], defaultValue: "HDFC Bank Custody" },
      { id: "fee_structure", label: "Chosen Fee Schedule", type: "select", options: ["Option A: Fixed 2.0% p.a. Management Fee", "Option B: Fixed 1.25% p.a. + 15% Performance Fee over 10% Hurdle Rate", "Option C: Zero Fixed + 20% Performance Fee over 12% Hurdle Rate"], required: true, defaultValue: "Option B: Fixed 1.25% p.a. + 15% Performance Fee over 10% Hurdle Rate" },
      { id: "hwm_principle", label: "High Water Mark Principle Agreed", type: "checkbox", defaultValue: true },
    ],
    declarations: [
      "I/We understand PMS is a discretionary portfolio management service with a regulatory minimum of ₹50 Lakhs under SEBI (PMS) Regulations 2020.",
      "Fund Horizon (ARN 345439) acts as distributor.",
      "High Water Mark (HWM) calculation rules have been reviewed and accepted.",
    ],
  },
  {
    id: "stallion_pma",
    title: "Stallion Discretionary Portfolio Management Agreement (PMA)",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-PMA-2026",
    version: "v2026.1",
    description: "Statutory client agreement governing investment discretion, custodian powers, and reporting.",
    badge: "Legal Agreement",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    specificFields: [
      { id: "investor_jurisdiction", label: "Place of Execution", type: "text", defaultValue: "Mumbai", required: true },
      { id: "communication_mode", label: "Quarterly Performance Reports Mode", type: "select", options: ["Electronic (Secure Email & Backoffice Portal)", "Physical Hardcopy"], defaultValue: "Electronic (Secure Email & Backoffice Portal)" },
      { id: "discretion_grant", label: "Grant Discretion to Fund Manager for Market Buys/Sells", type: "checkbox", defaultValue: true },
    ],
    declarations: [
      "The Portfolio Manager shall exercise discretion in good faith aligned with the strategy parameters.",
    ],
  },
  {
    id: "stallion_demat_poa",
    title: "Stallion Demat Account & POA Agreement (HDFC/Axis Custody)",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-POA-02",
    version: "v2026.1",
    description: "Limited Power of Attorney authorizing the custodian to settle securities for PMS portfolio.",
    badge: "Custody POA",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    specificFields: [
      { id: "custodian_name", label: "Designated Custodian", type: "text", defaultValue: "HDFC Bank Ltd - Custody Services", required: true },
      { id: "dp_id", label: "Depository Participant ID (DP ID)", type: "text", placeholder: "e.g. IN300126", defaultValue: "IN300126" },
      { id: "client_id", label: "Client ID / Demat Account No.", type: "text", placeholder: "e.g. 10293847", defaultValue: "10293847" },
    ],
    declarations: [
      "POA is strictly limited to execution of PMS investment transactions and custody settlement.",
    ],
  },
  {
    id: "stallion_fee_risk",
    title: "Stallion Fee Schedule & Risk Disclosure Document",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-FEE-DISC",
    version: "v2026.1",
    description: "SEBI Schedule IV risk factors, strategy drawdowns, and detailed fee breakdown confirmation.",
    badge: "Risk Disclosure",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    specificFields: [
      { id: "risk_acknowledgment", label: "Acknowledge Equity Market Volatility & Drawdown Risks", type: "checkbox", defaultValue: true },
      { id: "lockin_terms", label: "Exit Load / Redemption Term (1st Year: 2%, 2nd Year: 1%, Thereafter Nil)", type: "checkbox", defaultValue: true },
    ],
    declarations: [
      "I acknowledge that past performance is no guarantee of future returns.",
    ],
  },
  {
    id: "stallion_topup",
    title: "Stallion Additional Investment / Top-Up Slip",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-TOPUP-05",
    version: "v2026.1",
    description: "Inject additional capital into active Stallion PMS account with UTR / bank reference.",
    badge: "Capital Addition",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    specificFields: [
      { id: "topup_amount", label: "Additional Capital (₹)", type: "number", placeholder: "e.g. 1000000", required: true, defaultValue: "1000000" },
      { id: "remitting_bank", label: "Remitting Bank Name", type: "text", defaultValue: "HDFC Bank" },
      { id: "utr_number", label: "NEFT / RTGS UTR Number", type: "text", placeholder: "e.g. HDFCR520260412001", defaultValue: "HDFCR520260412001" },
    ],
    declarations: [
      "Funds transferred originate from the client's verified banking account.",
    ],
  },
  {
    id: "stallion_redemption",
    title: "Stallion Partial / Full Redemption & Strategy Switch Request",
    repository: "Stallion",
    category: "pms_stallion",
    formCode: "STALLION-REDEMP-06",
    version: "v2026.1",
    description: "Request liquidation of holdings, capital return, or strategy reallocation under Stallion PMS.",
    badge: "Capital Withdrawal",
    isAutomated: true,
    defaultAmc: "Stallion Asset Pvt Ltd",
    specificFields: [
      { id: "redemption_type", label: "Withdrawal Scope", type: "select", options: ["Partial Capital (Maintain ₹50L SEBI floor)", "Full Closure & Account Termination", "Strategy Rebalance"], required: true, defaultValue: "Partial Capital (Maintain ₹50L SEBI floor)" },
      { id: "requested_amount", label: "Redemption Amount (₹)", type: "number", placeholder: "e.g. 500000", defaultValue: "500000" },
      { id: "bank_account", label: "Target Bank Account for Proceeds", type: "text", defaultValue: "HDFC Bank - 50100234567890" },
    ],
    declarations: [
      "I confirm that post-withdrawal portfolio balance adheres to SEBI PMS regulatory limits.",
    ],
  },

  // --- OLD CLIENT FORMS (SERVICE REQUESTS) ---
  {
    id: "tax_status_change",
    title: "Tax Status Change Form (Resident to NRI / NRI to Resident)",
    repository: "CAMS",
    category: "old_client",
    formCode: "CAMS-SR-TAX-01",
    version: "v2026.1",
    description: "Update tax residency status, reclassify accounts between NRE/NRO/Resident, and adjust TDS rules.",
    badge: "Tax Residency",
    isAutomated: true,
    defaultAmc: "All Serviced Mutual Funds",
    specificFields: [
      { id: "old_tax_status", label: "Existing Tax Status", type: "select", options: ["Resident Individual", "Non-Resident Indian (NRE)", "Non-Resident Indian (NRO)", "Minor through Guardian"], required: true, defaultValue: "Resident Individual" },
      { id: "new_tax_status", label: "New Requested Tax Status", type: "select", options: ["Non-Resident Indian (NRO)", "Non-Resident Indian (NRE)", "Resident Individual"], required: true, defaultValue: "Non-Resident Indian (NRO)" },
      { id: "country_of_residence", label: "New Country of Tax Residence", type: "text", placeholder: "e.g. United Arab Emirates / USA / Singapore", required: true, defaultValue: "United Arab Emirates" },
      { id: "overseas_tax_id", label: "Overseas Tax Identification No. (TIN)", type: "text", placeholder: "TIN or N/A", defaultValue: "UAE-TAX-98210" },
      { id: "overseas_address", label: "Overseas Residential Address", type: "textarea", placeholder: "Full overseas address...", defaultValue: "Villa 14, Palm Jumeirah, Dubai, UAE" },
    ],
    declarations: [
      "I/We confirm departure from / return to India and request updated TDS withholding rates.",
      "Copy of Passport, Visa, and Foreign Address proof enclosed.",
    ],
  },
  {
    id: "nri_declaration_form",
    title: "NRI Declaration & Overseas Address Verification Form",
    repository: "Carvy",
    category: "old_client",
    formCode: "KFIN-NRI-DECL",
    version: "v2026.1",
    description: "FEMA declaration certifying Non-Resident status, banking channel compliance, and DTAA benefits.",
    badge: "FEMA Compliance",
    isAutomated: true,
    specificFields: [
      { id: "passport_number", label: "Passport Number", type: "text", required: true, defaultValue: "Z9182736" },
      { id: "visa_type", label: "Visa / Work Permit Type", type: "text", defaultValue: "Employment / Golden Visa", required: true },
      { id: "overseas_phone", label: "Overseas Contact Number", type: "text", defaultValue: "+971 50 1234567" },
      { id: "nre_nro_account", label: "NRE / NRO Bank Account Details", type: "text", defaultValue: "ICICI Bank NRO A/C 000401567890", required: true },
    ],
    declarations: [
      "I confirm that source of funds is through inward remittance or NRE/NRO account maintained under FEMA guidelines.",
    ],
  },
  {
    id: "marital_status_change",
    title: "Marital Status Change & Name Correction Declaration Form",
    repository: "CAMS",
    category: "old_client",
    formCode: "CAMS-SR-NAME-02",
    version: "v2026.1",
    description: "Name correction, surname modification post-marriage, and marital status update with Gazette proof.",
    badge: "Identity Update",
    isAutomated: true,
    specificFields: [
      { id: "old_legal_name", label: "Old Name as per Folio Records", type: "text", required: true, defaultValue: "Pooja Sharma" },
      { id: "new_legal_name", label: "New Full Legal Name", type: "text", required: true, defaultValue: "Pooja Kumar" },
      { id: "new_marital_status", label: "Updated Marital Status", type: "select", options: ["Married", "Single", "Divorced", "Widowed"], required: true, defaultValue: "Married" },
      { id: "supporting_document", label: "Supporting Legal Proof", type: "select", options: ["Marriage Certificate", "Official Gazette Notification", "Passport with Spouse Name"], defaultValue: "Marriage Certificate" },
      { id: "doc_reference_number", label: "Document Certificate / Gazette Ref No.", type: "text", defaultValue: "MC/MH/2026/04912" },
    ],
    declarations: [
      "I confirm that the individual named in the old records and new records is one and the same person.",
    ],
  },
  {
    id: "email_id_change",
    title: "Email ID Change & Digital Communication Mandate Form",
    repository: "CAMS",
    category: "old_client",
    formCode: "CAMS-SR-EML-03",
    version: "v2026.1",
    description: "Update primary email address for CAS statements, transaction OTPs, and valuation notices.",
    badge: "Contact Update",
    isAutomated: true,
    specificFields: [
      { id: "old_email", label: "Old Registered Email", type: "text", defaultValue: "old.email@workmail.com", required: true },
      { id: "new_email", label: "New Email Address to Register", type: "text", placeholder: "e.g. client.personal@domain.com", defaultValue: "client.personal@gmail.com", required: true },
      { id: "email_ownership", label: "Email Belongs To", type: "select", options: ["Self", "Spouse", "Dependent Children", "Dependent Parents"], defaultValue: "Self" },
      { id: "reason_for_change", label: "Reason for Change", type: "select", options: ["Left previous employer", "Consolidating communications", "Personal preference"], defaultValue: "Consolidating communications" },
    ],
    declarations: [
      "I consent to receiving all official statements, contract notes, and statutory notices electronically at the new email.",
    ],
  },
  {
    id: "phone_number_change",
    title: "Phone Number Change & 2FA Contact Updation Request",
    repository: "Carvy",
    category: "old_client",
    formCode: "KFIN-SR-MOB-04",
    version: "v2026.1",
    description: "Update mobile number for two-factor authentication, transaction OTPs, and SMS transaction alerts.",
    badge: "Security Update",
    isAutomated: true,
    specificFields: [
      { id: "old_mobile", label: "Old Registered Mobile Number", type: "text", defaultValue: "+91 98111 22233", required: true },
      { id: "new_mobile", label: "New Mobile Number to Register", type: "text", placeholder: "+91 XXXXX XXXXX", defaultValue: "+91 98765 43210", required: true },
      { id: "mobile_ownership", label: "Mobile Belongs To", type: "select", options: ["Self", "Spouse", "Dependent Children", "Dependent Parents"], defaultValue: "Self" },
      { id: "id_proof_attached", label: "Identity Proof Attached", type: "select", options: ["Aadhaar with OTP verify", "Passport", "Driving License", "PAN Card"], defaultValue: "Aadhaar with OTP verify" },
    ],
    declarations: [
      "I authorize KFintech and the AMC to deliver critical transaction authorizations and SMS alerts to the new number.",
    ],
  },
  {
    id: "bank_change_form",
    title: "Change in Bank Mandate & Multiple Bank Accounts Registration",
    repository: "CAMS",
    category: "old_client",
    formCode: "CAMS-SR-BNK-05",
    version: "v2026.2",
    description: "Register new default redemption/dividend bank account with cancelled cheque proof validation.",
    badge: "Core Service",
    isAutomated: true,
    specificFields: [
      { id: "new_bank_name", label: "New Bank Name", type: "text", required: true, defaultValue: "HDFC Bank Ltd" },
      { id: "new_account_number", label: "New Bank Account Number", type: "text", required: true, defaultValue: "50100987654321" },
      { id: "new_account_type", label: "New Account Type", type: "select", options: ["Savings", "Current", "NRE", "NRO"], defaultValue: "Savings" },
      { id: "new_ifsc", label: "New Bank IFSC Code", type: "text", required: true, defaultValue: "HDFC0000123" },
      { id: "new_branch", label: "Branch Name & City", type: "text", defaultValue: "Worli Branch, Mumbai" },
      { id: "old_bank_name", label: "Existing / Old Bank Name", type: "text", defaultValue: "State Bank of India" },
      { id: "old_account_number", label: "Old Bank Account Number (Last 4 digits)", type: "text", defaultValue: "XXXXXX7891" },
      { id: "cheque_attached", label: "Original Cancelled Cheque with Pre-Printed Name Enclosed", type: "checkbox", defaultValue: true },
    ],
    declarations: [
      "I confirm that the new bank account stands in my name as sole/first holder.",
      "A cooling period of up to 10 calendar days may apply for redemption payout to new bank account under SEBI rules.",
    ],
  },
  {
    id: "redemption_mandate_change",
    title: "Change in Redemption Mandate & Direct Credit Payout Updation",
    repository: "Carvy",
    category: "old_client",
    formCode: "KFIN-SR-RED-06",
    version: "v2026.1",
    description: "Designate specific verified registered bank account as primary payout mandate for redemptions.",
    badge: "Payout Mandate",
    isAutomated: true,
    specificFields: [
      { id: "primary_payout_bank", label: "Designated Payout Bank", type: "text", required: true, defaultValue: "HDFC Bank Ltd" },
      { id: "payout_account_no", label: "Payout Account Number", type: "text", required: true, defaultValue: "50100987654321" },
      { id: "payout_mode", label: "Preferred Payout Mode", type: "select", options: ["Direct Credit / RTGS / NEFT", "Cheque / Warrant"], defaultValue: "Direct Credit / RTGS / NEFT" },
    ],
    declarations: [
      "All future redemption proceeds and income distribution payments will be credited directly to this chosen bank account.",
    ],
  },
  {
    id: "transmission_units_form",
    title: "Transmission of Units Form (Claimant / Nominee Settlement)",
    repository: "CAMS",
    category: "old_client",
    formCode: "AMFI-TRANS-07",
    version: "v2026.1",
    description: "Transmission of mutual fund units to registered nominee or surviving joint holders on demise of investor.",
    badge: "Legal Settlement",
    isAutomated: true,
    specificFields: [
      { id: "deceased_holder_name", label: "Deceased Holder Full Name", type: "text", required: true, defaultValue: "Late Ramesh Kumar" },
      { id: "date_of_death", label: "Date of Demise", type: "date", required: true, defaultValue: "2026-01-15" },
      { id: "claimant_name", label: "Claimant / Nominee Full Name", type: "text", required: true, defaultValue: "Pooja Kumar" },
      { id: "claimant_pan", label: "Claimant PAN", type: "text", required: true, defaultValue: "ABCDE5678K" },
      { id: "death_certificate_no", label: "Death Certificate Registration No.", type: "text", defaultValue: "MCGM/DC/2026/01928" },
    ],
    declarations: [
      "Claimant undertakes full legal indemnity under AMFI transmission guidelines.",
    ],
  },
  {
    id: "minor_to_major_form",
    title: "Minor Attaining Majority (MAM) Status Change & KYC Transition",
    repository: "CAMS",
    category: "old_client",
    formCode: "CAMS-MAM-08",
    version: "v2026.1",
    description: "Transition folio status from Minor to Major upon turning 18, with independent bank account and KYC.",
    badge: "MAM Transition",
    isAutomated: true,
    specificFields: [
      { id: "guardian_name", label: "Existing Guardian Full Name", type: "text", defaultValue: "Rajesh Kumar", required: true },
      { id: "major_pan", label: "Major Applicant PAN Card Number", type: "text", required: true, defaultValue: "ABCDE9876M" },
      { id: "date_of_majority", label: "Date of 18th Birthday", type: "date", required: true, defaultValue: "2026-03-10" },
      { id: "independent_bank_ac", label: "New Independent Bank Account in Major's Name", type: "text", defaultValue: "HDFC Bank - 50100445566778", required: true },
    ],
    declarations: [
      "Guardian's operational authority is revoked. Major applicant assumes sole operation of the folio.",
    ],
  },
];

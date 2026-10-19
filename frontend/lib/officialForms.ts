// Official forms, linked straight from the publisher (RTA / PMS site) so they are always the current version.
// Every URL was checked to return the stated type. CAMS publishes its forms only through a script-rendered page,
// so those entries are the official CAMS form pages rather than PDFs.
import type { FormRepository } from "@/lib/operationsForms";

export interface OfficialForm {
  title: string;
  repository: FormRepository;
  url: string;
  kind: "PDF" | "Page";
}

const kf = (title: string, url: string): OfficialForm => ({ title, repository: "Carvy", url, kind: "PDF" });
const cams = (title: string, url: string): OfficialForm => ({ title, repository: "CAMS", url, kind: "Page" });
const st = (title: string, url: string, kind: OfficialForm["kind"] = "PDF"): OfficialForm => ({ title, repository: "Stallion", url, kind });

const CAMS = "https://www.camsonline.com/Investors";
const KF = "https://mfs.kfintech.com/mfs";
const KFD = "https://mfs.kfintech.com/mfs/Generalpages/downloads";
const SA = "https://www.stallionasset.com";

export const OFFICIAL_FORMS: OfficialForm[] = [
  cams("CAMS Service Request Forms (all forms)", `${CAMS}/Service-requests/Service-Request-Forms`),
  cams("CAMS Additional Purchase / Redemption / Switch Slips", `${CAMS}/Transactions/Paper-Financial-Transaction-request`),
  cams("CAMS Switch Transaction Slip", `${CAMS}/Transactions/Paper-Financial-Transaction-request/Switch-transaction-slip`),
  cams("CAMS Nomination Form", "https://www.camsonline.com/Distributors/Service-Requests/Service-Request-Forms/Nomination-Form"),
  cams("CAMS Change of Bank Mandate", `${CAMS}/Service-requests/Change-Bank-Mandate`),
  cams("CAMS Minor Attains Majority Form", `${CAMS}/Service-requests/Service-Request-Forms/Minor-attains-Major`),
  kf("KFintech Common Transaction Form", `${KF}/InvestorServices/COMMON%20TRANSACTION%20FORM.pdf`),
  kf("KFintech SIP / STP / SWP Cancellation Request", `${KF}/InvestorServices/Request%20For%20Cancellation%20Of%20%20SIP-STP-SWP.pdf`),
  kf("KFintech Multiple Bank Account Registration", `${KFD}/Multiple-bankregistration.pdf`),
  kf("KFintech Email / Mobile / Family Declaration", `${KFD}/EMAIL%20MOBILE%20UPDATION.pdf`),
  kf("KFintech Nomination: Fresh / Change / Cancellation", `${KFD}/Fresh%20%20Change%20Cancellation%20of%20Nominatin.docx.pdf`),
  kf("KFintech Nomination Opt-out", `${KFD}/Nomination%20Opt%20Out.pdf`),
  kf("KFintech Service Request for PAN / PEKRN", `${KFD}/SRForm_PAN.pdf`),
  kf("KFintech PAN-based Email / Mobile Update", `${KFD}/KFintech_PAN_base_request_form_NEW.pdf`),
  kf("KFintech KYC Form (Individual)", `${KFD}/CKYC-KRA-KYC-FormforIndividuals.pdf`),
  kf("KFintech KYC Form (Non-Individual)", `${KFD}/NonIndividual-KYC.pdf`),
  kf("KFintech FATCA Form (Individuals)", `${KFD}/KFIN_FATCA-Individuals.pdf`),
  kf("KFintech FATCA & UBO Combined (Entities)", `${KFD}/FATCA_UBO_COMBINED_NON_INDIVIDUALS.pdf`),
  kf("KFintech UBO Declaration", `${KFD}/UBO_Format.pdf`),
  kf("KFintech NPO Declaration", `${KFD}/NPO-Declaration_Form.pdf`),
  kf("KFintech Consent Form (MFD as Joint Holder)", `${KFD}/Consent_form.pdf`),
  kf("KFintech Change of Broker Code", `${KFD}/Change%20in%20Brok%20Code.pdf`),
  kf("KFintech Form 121", `${KFD}/Form%20121.pdf`),
  { title: "KFintech NACH / Mandate Forms", repository: "Carvy", url: "https://mfs.kfintech.com/investor/General/NACHFormMandates", kind: "Page" },
  st("Stallion Asset PMS Disclosure Document", `${SA}/regulatory/SAPL_Disclosure_Document_21_09_2026.pdf`),
  st("Stallion Asset PMS Investor Charter", `${SA}/regulatory/INVESTOR_CHARTER_PMS_STALLION_(17).pdf`),
  st("Stallion Asset PMS Charges", `${SA}/attach_sendgrid/Stallion%20Asset%20PMS%20Charges_July2025.pdf`),
  st("Stallion Asset PMS page (account opening and withdrawal forms are issued by operations@stallionasset.com)", `${SA}/pms`, "Page"),
];

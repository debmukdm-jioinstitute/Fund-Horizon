"""Rebuild data/official_forms.json: official CAMS and KFintech (Karvy) forms.

Every non-CAMS URL is fetched and must return the expected type, so a dead link is dropped. CAMS blocks non-browser
clients, so its entries were verified in a real browser; re-check them there when this list changes.
"""
import json,subprocess,concurrent.futures as cf
from pathlib import Path
C="https://www.camsonline.com"; CI=C+"/Investors"; CD=C+"/assets/PDF/"
K="https://mfs.kfintech.com"; KG=K+"/mfs/Generalpages/downloads/"; KI=K+"/mfs/InvestorServices/"; KT=K+"/investor/img/guidelinestransmission/img/"
R="https://ris.kfintech.com/clientservices/investors/Templates/"; KR="https://karisma.kfintech.com/downloads/"
F=[]
def a(src,cat,title,url,kw=""): F.append(dict(source=src,category=cat,title=title,url=url,kind="PDF" if url.lower().split('?')[0].endswith(('.pdf','.docx','.doc','.xls','.xlsx')) else "Page",keywords=kw))
# ---- CAMS
cams=lambda *x:a("CAMS",*x)
cams("Transactions","CAMS Additional Purchase Transaction Slip",CI+"/Transactions/Paper-Financial-Transaction-request/Additional-purchase-slip","purchase top up lumpsum slip")
cams("Transactions","CAMS Redemption Transaction Slip",CI+"/Transactions/Paper-Financial-Transaction-request/Redemption-slip","withdraw sell slip")
cams("Transactions","CAMS Switch Transaction Slip",CI+"/Transactions/Paper-Financial-Transaction-request/Switch-transaction-slip","switch slip")
cams("Transactions","CAMS SIP / STP / SWP Cancellation Request",CI+"/Service-requests/Service-Request-Forms/SIP-STP-SWP-Cancellation-request","stop sip terminate")
cams("Bank mandate & payments","CAMS Registration / Cancellation of Bank Mandate",CI+"/Service-requests/Service-Request-Forms/Bank-Mandate-registration&cancellation","change bank multiple bank accounts")
cams("Bank mandate & payments","CAMS Bank Accounts Registration Form (PDF)",CD+"Bank_Accounts_Registration_Form.pdf","bank mandate multiple banks")
cams("Bank mandate & payments","CAMS Bank Mandate with Banker Attestation",CI+"/Service-requests/Service-Request-Forms/Bank-Mandate-with-Banker-Attestation","signature update bank attestation")
cams("Bank mandate & payments","CAMS Digital Bank Mandate Change",CI+"/Service-requests/Change-Bank-Mandate/Digital-Bank-Mandate-Change","online bank change")
cams("Bank mandate & payments","CAMS eNACH / eMandate (CAMSPay)",CI+"/Service-requests/eNACH-eMandate/CAMSPay-eMandate","nach emandate sip mandate")
cams("Bank mandate & payments","CAMS Redemption or IDCW Revalidation",CI+"/Service-requests/Service-Request-Forms/Redemption-IDCW-Revalidation","dividend warrant cheque revalidate")
cams("Nomination","CAMS Nomination Opt-in / Opt-out (physical form page)",CI+"/Service-requests/Service-Request-Forms/Nomination_Opt-in_or_Opt-out","nominee")
cams("Nomination","CAMS Nomination Form (PDF)",CD+"Nomination_Form.pdf","nominee registration opt in")
cams("Nomination","CAMS Nomination Opt-out Form (PDF)",CD+"Nomination_Opt-out_Form.pdf","nominee opt out declaration")
cams("Contact & folio updates","CAMS Email / Mobile Updation & Family Declaration Form",CD+"EMAIL_MOBILE_UPDATE/Updation_of_contact_details_%26_Family_Declaration_Form_V1.pdf","email mobile phone contact family declaration")
cams("Contact & folio updates","CAMS PAN Updation Form",CD+"EMAIL_MOBILE_UPDATE/PAN_UPDATION_FORM.pdf","pan update")
cams("Contact & folio updates","CAMS PAN-based Service Request Form",CD+"EMAIL_MOBILE_UPDATE/PAN_base_request_form.pdf","pan based email mobile nominee")
cams("Contact & folio updates","CAMS Mutual Fund PAN & KYC Updation (online)",CI+"/Service-requests/GoGreen/Pan-updation","pan kyc update online")
cams("Contact & folio updates","CAMS Consolidation of Folios",CI+"/Service-requests/Service-Request-Forms/Folio-Consolidation","merge folios aggregate")
cams("Contact & folio updates","CAMS Minor Attains Majority Form",CI+"/Service-requests/Service-Request-Forms/Minor-attains-Major","minor major guardian tax status")
cams("Contact & folio updates","CAMS Change of Broker (ARN) Request",CD+"Request_for_Change_in_Broker.pdf","broker arn change distributor")
cams("KYC & compliance","CAMSKRA KYC Form (CKYC / Non-Individual)",CD+"CAMSKRA_Form_KYC.pdf","ckyc kra kyc application non individual")
cams("KYC & compliance","CAMS UBO Declaration Form",CD+"EMAIL_MOBILE_UPDATE/UBO-Declaration.pdf","ultimate beneficial owner")
cams("KYC & compliance","CAMS NPO (Non-Profit Organisation) Declaration",CD+"EMAIL_MOBILE_UPDATE/NPO-Declaration.pdf","npo trust")
cams("KYC & compliance","CAMS FATCA & CRS Declaration",CI+"/Service-requests/FATCA&CRS","fatca crs tax residency")
cams("KYC & compliance","CAMS KYC Modification Form",CD+"KYC_Modification.pdf","kyc change modify")
cams("KYC & compliance","CAMS KYC (online / paperless)",CI+"/Transactions/KYC/Paper-less-KYC","ekyc kyc status")
cams("Transmission & incapacitation","CAMS Transmission Helpdesk (death claim)",CI+"/Service-requests/Transmission/Transmission-Helpdesk","transmission deceased nominee legal heir")
cams("Transmission & incapacitation","CAMS Incapacitation Intimation Letter Format",CD+"SOP/Incapacitation_Intimation_Letter_Format.pdf","incapacitated investor")
cams("Guides & circulars","CAMS SOP for Incapacitated Investors",CD+"SOP/SOP_for_Incapacitated_Investors.pdf","sop incapacitated")
cams("Guides & circulars","CAMS FAQs on Unclaimed Mutual Funds",CD+"SOP/FAQs_on_Unclaimed_Mutual_Funds.pdf","unclaimed idcw redemption")
cams("Guides & circulars","CAMS KYC Remediation FAQ",CD+"KYCRemediationFAQ.pdf","kyc faq")
cams("Guides & circulars","CAMS FAQs on revised KYC process (1 Apr 2024)",CD+"FAQs_on_revised_KYC_process_1st_April_2024.pdf","kyc faq")
cams("Guides & circulars","CAMS Email / Mobile cleanup FAQs",CD+"EMAIL_MOBILE_UPDATE/FAQs-Email%20_Mobile_cleanup.pdf","faq email mobile")
cams("Distributor","CAMS Request for RIA Registration",C+"/Distributors/Service-Requests/RIA-Registration-Form","ria registration")
cams("Distributor","CAMS GSTIN Registration & Invoice",C+"/Distributors/Service-Requests/GSTIN-Registration&Invoice","gst invoice distributor")
cams("Distributor","CAMS Distributor Mailback Services",C+"/Distributors/Service-Requests/Distributor-Mailback-Services","mailback statement")
cams("Distributor","CAMS Distributor User Manual",CD+"usermanual/Distributor-user-manual.pdf","manual")
cams("Distributor","CAMS GST Invoice Upload Process Flow",CD+"GST_Invoice_Upload_Process_Flow.pdf","gst")
cams("Statements & other","CAMS Consolidated Account Statement (CAS)",CI+"/Statements/Consolidated-Account-Statement","cas statement")
cams("Statements & other","CAMS Capital Gain / Loss Statement",CI+"/Statements/Capital-Gain&Capital-Loss-statement","capital gains tax")
cams("Statements & other","CAMS All Service Request Forms (index)",CI+"/Service-requests/Service-Request-Forms","index all forms")
# ---- KFintech (Karvy)
kf=lambda *x:a("KFintech",*x)
kf("Transactions","KFintech Common Transaction Form (purchase / redemption / switch)",KI+"COMMON%20TRANSACTION%20FORM.pdf","ctf additional purchase redemption switch address bank")
kf("Transactions","KFintech SIP / STP / SWP Cancellation Request",KI+"Request%20For%20Cancellation%20Of%20%20SIP-STP-SWP.pdf","stop sip terminate")
kf("Transactions","KFintech Transaction Slip (online generator)",K+"/investor/General/TransactionSlip","purchase redemption switch slip")
kf("Transactions","KFintech Form 121",KG+"Form%20121.pdf","form 121")
kf("Bank mandate & payments","KFintech Multiple Bank Account Registration",KG+"Multiple-bankregistration.pdf","change bank mandate")
kf("Bank mandate & payments","KFintech NACH / OTM Mandate Format",K+"/investor/Manuals/NACH_MANDATE_FORMAT_Rev.pdf","nach mandate sip")
kf("Bank mandate & payments","KFintech NACH Form Mandates (info)",K+"/investor/General/NACHFormMandates","nach")
kf("Bank mandate & payments","KFintech eNACH / OTM Cancellation",K+"/investor/General/eNACHOTMCancellation","otm cancel emandate")
kf("Bank mandate & payments","KFintech RTGS / NEFT RBI Circular",KG+"RTGNEFTNEWRBICIRCULAR.pdf","rtgs neft")
kf("Nomination","KFintech Nomination: Fresh / Change / Cancellation",KG+"Fresh%20%20Change%20Cancellation%20of%20Nominatin.docx.pdf","nominee annexure a")
kf("Nomination","KFintech Nomination Opt-out",KG+"Nomination%20Opt%20Out.pdf","nominee opt out")
kf("Nomination","KFintech MF Nomination Form",KT+"Forms/MF_NominationForm.pdf","nominee")
kf("Contact & folio updates","KFintech Email / Mobile / Family Declaration",KG+"EMAIL%20MOBILE%20UPDATION.pdf","email mobile family")
kf("Contact & folio updates","KFintech Service Request for PAN / PEKRN",KG+"SRForm_PAN.pdf","pan pekrn")
kf("Contact & folio updates","KFintech PAN-based Email / Mobile Update",KG+"KFintech_PAN_base_request_form_NEW.pdf","pan based")
kf("Contact & folio updates","KFintech PAN Based Services Annexure 1",KG+"Annexure1.pdf","pan annexure")
kf("Contact & folio updates","KFintech PAN Based Services Annexure 2",KG+"PAN-Annexure2.pdf","pan annexure")
kf("Contact & folio updates","KFintech PAN Based Services Annexure 3",KG+"Annexure3.pdf","pan annexure")
kf("Contact & folio updates","KFintech PAN Based Services (online)",K+"/investor/General/PANBasedServices","pan based online")
kf("Contact & folio updates","KFintech Change of Broker Code",KG+"Change%20in%20Brok%20Code.pdf","broker arn change")
kf("Contact & folio updates","KFintech Consent Form (MFD as Joint Holder)",KG+"Consent_form.pdf","distributor joint holder")
kf("KYC & compliance","KFintech KYC Form (Individual)",KG+"CKYC-KRA-KYC-FormforIndividuals.pdf","ckyc kra individual")
kf("KYC & compliance","KFintech KYC Form (Non-Individual)",KG+"NonIndividual-KYC.pdf","kyc entity")
kf("KYC & compliance","KFintech KYC Form Individual (legacy)",K+"/mfs/GeneralPages/downloads/Individual.pdf","kyc individual")
kf("KYC & compliance","KFintech KYC Form Non-Individual (legacy)",K+"/mfs/GeneralPages/downloads/KYC%20NonIndividual.pdf","kyc non individual")
kf("KYC & compliance","KFintech Form 49A (PAN application)",K+"/mfs/GeneralPages/downloads/Form49aE.pdf","pan application 49a")
kf("KYC & compliance","KFintech FATCA Form (Individuals)",KG+"KFIN_FATCA-Individuals.pdf","fatca crs")
kf("KYC & compliance","KFintech FATCA & UBO Combined (Entities)",KG+"FATCA_UBO_COMBINED_NON_INDIVIDUALS.pdf","fatca ubo entity")
kf("KYC & compliance","KFintech FATCA / CRS Declaration (Individual)",K+"/mfs/FATCA_CRS_Declaration_form_Individual.pdf","fatca crs")
kf("KYC & compliance","KFintech FATCA / CRS Declaration (Entities)",K+"/mfs/FATCA_CRS_Declaration_form_Entities.pdf","fatca crs")
kf("KYC & compliance","KFintech UBO Declaration",KG+"UBO_Format.pdf","ultimate beneficial owner")
kf("KYC & compliance","KFintech NPO Declaration",KG+"NPO-Declaration_Form.pdf","npo")
kf("KYC & compliance","KFintech Self Declaration",K+"/mfs/Self-Declaration.pdf","self certification")
kf("KYC & compliance","KFintech AML Policy",K+"/mfs/GeneralPages/downloads/AML-Policy.pdf","aml")
kf("KYC & compliance","KFintech KYC Guidelines (documents required)",K+"/mfs/GeneralPages/downloads/KYC%20Guidelines_Revised.pdf","kyc documents")
kf("KYC & compliance","AMFI Prescribed Documents for Proof of Identity & Address",K+"/mfs/GeneralPages/downloads/AMFI%20-PrescribedDocuments%20for%20proof%20of%20Identity%20and%20Address.pdf","poi poa")
kf("KYC & compliance","KFintech KYC FAQs (April 2024 changes)",KG+"FAQsonKYCprocesschangeseffectivefromApril012024.pdf","kyc faq")
kf("KYC & compliance","KFintech Aadhaar KYC Process",K+"/investor/General/AadhaarKYCProcess","aadhaar ekyc")
for n,u in [("T1 - Deletion of Name of Deceased 2nd/3rd Joint Holder","Form_T1_for_Deletion_of_Name_of_Deceased_2nd_or_3rd_Jt_Holder_March2024.pdf"),("T2 - Transmission where 1st Holder is Deceased","Form_T2_for_Transmission_of_Units_Where_the_1st_holder_is_Deceased_March_2024.pdf"),("T3 - Transmission Request for Nominee & Legal Heir","Form_T3_for_Transmission_Request_for_Nominee_Legal_Heir_March_2024.pdf"),("T4 - Change of Karta upon demise of Karta","Form_T4_for_Transmission_Request_for_change_of_Karta_upon_demise_of_regd_Karta_March_2024.pdf"),("T5 - Transmission where HUF is dissolved","Form_T5_Transmission_Request_where_HUF_is_dissolved_upon_demise_of_Karta_Revised_Mar_2024.pdf")]:
    kf("Transmission & incapacitation","KFintech Transmission Form "+n,KT+"Forms/"+u,"transmission death deceased nominee legal heir huf")
for n,u in [("Ia - Bank Attestation of Signature & Bank Account Details","Annexure_Ia_Bank_Attestation_of_Signature_And_bank_account_details.pdf"),("Ib - Bank Attestation of Signature of New Karta","Annexure_Ib_Bank_Attestation_of_Signature_of_the_new_Karta.pdf"),("II - Bond of Indemnity (Legal Heirs, no Legal Representation)","Annexure-II_Bond_of_Indemnity_to_be_furnished_jointly_by_Legal_Heirs_for_Transmission_without_Legal_Representation.pdf"),("III - Individual Affidavits of Legal Heirs","Annexure_III_Individual_Affidavits_to_be_given_by_ALL_the_Legal_Heirs.pdf"),("IV - NOC from Other Legal Heirs","Annexure_IV_NOC_from_other_legal_heirs.pdf"),("V - Indemnity from Coparceners (Change of Karta)","AnnexureV-Indemnity_from_coparceners_for_change_of_Karta.pdf"),("VI - Bond of Indemnity (Dissolved HUF)","Annexure_VI_Bond_of_Indemnity_by_surviving_member_of_dissolved_HUF.pdf")]:
    kf("Transmission & incapacitation","KFintech Transmission Annexure "+n,KT+"Annexures/"+u,"transmission annexure indemnity affidavit noc")
kf("Transmission & incapacitation","KFintech Transmission Guidelines (all scenarios)",K+"/investor/General/GuidelinesTransmission","transmission guidelines documents")
kf("Transmission & incapacitation","KFintech SOP: Demise Intimation Upload",K+"/investor/Manuals/SOP_Demise_IntimationUpload.pdf","demise sop")
kf("Guides & circulars","KFintech Circular for Mutual Funds",KG+"cirimddf.pdf","circular")
kf("Guides & circulars","KFintech FAQs on Unclaimed Mutual Funds (English)",K+"/investor/Manuals/SOP_FAQs_English.pdf","unclaimed")
kf("Guides & circulars","KFintech Investor User Manual",K+"/investor/Manuals/User%20Manual-Investor.pdf","manual")
kf("Guides & circulars","KFintech KTRACK User Guide",KI+"KTrack%20User%20Guide%20V2.pdf","ktrack")
kf("Guides & circulars","KFintech DEMAT / REMAT & Redemption Process Note",K+"/mfs/PROCESS%20NOTE%20ON%20DMAT-REMAT%20&%20REDEMPTION%20OF%20UNITS%20Ver%202%202%2026%20APR%202013.pdf","demat remat")
kf("Distributor","KFintech Distributor Manual",K+"/mfs/Distributor/Downloads/DistributorManual.pdf","distributor manual")
kf("Distributor","KFintech Service Request Forms (all)",K+"/mfs/Generalpages/Download%20Forms.aspx?frm=iC","index all forms")
# ---- KFintech Corporate Registry (Karvy RIS: equity shares) 
kr=lambda *x:a("KFintech",*x)
for n,u,kw in [("ISR-1 Request for Registering PAN, KYC, Bank & Specimen Signature","2Form_ISR-1.pdf","isr1 kyc pan bank shares"),("ISR-2 Confirmation of Signature of Securities Holder by Bank","3Form_ISR-2.pdf","isr2 signature bank"),("ISR-3 Declaration for Opting Out of Nomination","6Form_ISR-3.pdf","isr3 nomination opt out"),("ISR-4 Request for Issue of Duplicate Certificate / Service Requests","Form-ISR-4.pdf","isr4 duplicate"),("SH-13 Nomination Form","Form_SH13_NOMINATION_FORM.pdf","sh13 nomination"),("SH-14 Cancellation / Variation of Nomination","Form_SH14.pdf","sh14 nomination"),("Form A - Affidavit for Duplicate Securities","Form_A_Affidavit_for_issuance_of_duplicate_securities.pdf","duplicate affidavit"),("Form B - Indemnity for Duplicate Securities","Form_B_Indemnity_for_issuance_of_duplicate_securities.pdf","duplicate indemnity"),("NSDL DCRF (Demat Request)","nsdl_dcrf_format.pdf","dcrf demat nsdl"),("CDSL DCRF (Demat Request)","cdsl_dcrf_format.pdf","dcrf demat cdsl"),("ISR-5 Annexure C","Annexure-C-ISR5.pdf","isr5"),("Annexure D","Annexure-D.pdf","annexure"),("Annexure E","Annexure-E.pdf","annexure"),("Annexure F","Annexure-F.pdf","annexure")]:
    kr("Corporate registry (shares)","KFintech (Karvy) Shares: Form "+n if n[:3] in("ISR","SH-","For") else "KFintech (Karvy) Shares: "+n,KR+u,kw+" equity shares rta")
for n,u,kw in [("Form 121 (TDS exemption)","TDS_Form-121.pdf","form 121 tds"),("Form 121 Guidelines","TDS_Form-121_Guidelines.pdf","form 121 guidelines"),("Form 41","Form-41.pdf","form 41"),("Self Declaration by Non-Residents","SelfDeclarationNRI.pdf","nri tds"),("Self Declaration by Residents","Self%20declaration%20by%20Resident.pdf","resident tds"),("Self Declaration for DTAA Applicability","Self%20declaration%20for%20DTAA%20applicability.pdf","dtaa"),("Declaration under Rule 203","Declaration%20under%20Rule%20203.pdf","rule 203")]:
    kr("Tax & TDS (shares)","KFintech Shares Tax: "+n,R+u,kw+" tax exemption 15g 15h dividend")
# ---- Stallion Asset PMS (account-opening forms are issued by operations@stallionasset.com, not published)
SA="https://www.stallionasset.com"
for n,u,kw in [("Disclosure Document","/regulatory/SAPL_Disclosure_Document_21_09_2026.pdf","disclosure"),("Investor Charter","/regulatory/INVESTOR_CHARTER_PMS_STALLION_(17).pdf","charter"),("PMS Charges","/attach_sendgrid/Stallion%20Asset%20PMS%20Charges_July2025.pdf","fees charges")]:
    a("Stallion","PMS (Stallion)","Stallion Asset PMS "+n,SA+u,kw+" pms")
a("Stallion","PMS (Stallion)","Stallion Asset PMS page (account opening and withdrawal forms are issued by operations@stallionasset.com)",SA+"/pms","pms account opening")
# dedupe
seen=set(); out=[]
for f in F:
    if f["url"] in seen: continue
    seen.add(f["url"]); out.append(f)
def chk(f):
    if f["source"]=="CAMS": return f,"200 application/pdf text/html (verified in browser)"
    u=f["url"].replace(" ","%20"); r=""
    for _ in range(3):  # transient connection errors are common on these hosts
        r=subprocess.run(["curl","-s","-o","/dev/null","-A","Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36","-H","Accept: text/html,application/pdf,*/*;q=0.8","-L","--max-time","30","-w","%{http_code} %{content_type}",u],capture_output=True,text=True).stdout
        if r.startswith("200"): break
    return f,r
ok=[];bad=[]
with cf.ThreadPoolExecutor(12) as ex:
    for f,r in ex.map(chk,out):
        code=r.split()[0] if r else "ERR"
        pdf=f["kind"]=="PDF"
        good = code=="200" and (("pdf" in r.lower() or "word" in r.lower() or "octet" in r.lower() or "excel" in r.lower() or "msword" in r.lower()) if pdf else "html" in r.lower())
        (ok if good else bad).append((f,r))
print(len(out),len(ok),len(bad))
for f,r in bad: print("BAD",r,f["url"])
json.dump([f for f,_ in ok],open(Path(__file__).resolve().parents[2]/"data"/"official_forms.json","w"),indent=1,ensure_ascii=False)

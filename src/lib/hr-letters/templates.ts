// HR Letter templates — exact wording ported from the user's own
// HR_Letters_Certificates_Company_Policy.docx (extracted via pandoc,
// 2026-08-06), with [BRACKETED] placeholders turned into {{tokens}}.
// Nothing here is invented — every sentence is the user's original text,
// just parameterized. See CAPABILITY_INFO's hr_letters entry for the
// capability gate.
//
// Design: each template renders into ONE editable body textarea (built by
// substituting the current field values into bodyTemplate) rather than a
// fully-structured document — matches item 7's "always editable before
// print" principle and keeps every letter type using the same generic
// form/preview/print component (letter-form.tsx) instead of one-off UIs.

export type LetterFieldType = "text" | "textarea" | "date" | "number" | "select";

export type LetterField = {
  key: string;
  label: string;
  type: LetterFieldType;
  default?: string;
  /** Only for type "select" — the choices shown in the form (and the exact
   *  values substituted into the body, e.g. "15 days"). */
  options?: string[];
};

export type LetterTemplate = {
  slug: string;
  title: string;
  icon: string;
  subject: string; // may contain {{tokens}}
  toWhomsoever: boolean; // true = "TO WHOMSOEVER IT MAY CONCERN" (no addressee block)
  fields: LetterField[]; // template-specific fields, IN ADDITION to the common employee/date/ref fields
  bodyTemplate: string; // {{tokens}} substituted to build the initial editable body text
  /**
   * 2026-10-23 — optional hook for a template that needs a token which is
   * COMPUTED from the filled-in fields rather than typed directly. The
   * company-issued notice letter is the first user: its notice period is a
   * dropdown (10/15/20 days, 1-6 months) with a "custom" choice, so the
   * value printed in the letter body has to fall back to the custom text
   * box when that choice is picked. Runs AFTER date fields are formatted
   * (so it sees "07 November 2026", not "2026-11-07"), and only affects the
   * body — the subject line is rendered from the raw field values.
   */
  derive?: (values: Record<string, string>) => Record<string, string>;
};

const today = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

export const LETTER_TEMPLATES: LetterTemplate[] = [
  {
    slug: "offer-letter",
    title: "Offer Letter",
    icon: "📩",
    subject: "Offer of Employment",
    toWhomsoever: false,
    fields: [
      { key: "job_title", label: "Job Title", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "manager_name", label: "Reporting Manager (Name / Designation)", type: "text" },
      { key: "date_of_joining", label: "Date of Joining", type: "date" },
      { key: "work_location", label: "Work Location", type: "text" },
      { key: "annual_ctc", label: "Annual CTC", type: "text" },
      { key: "employment_type", label: "Employment Type", type: "text", default: "Full-Time" },
      { key: "acceptance_deadline", label: "Acceptance Deadline", type: "date" },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "We are pleased to offer you the position of {{job_title}} in the {{department}} at {{company_name}}. " +
      "This offer is based on the information provided by you and the discussions held during the interview process.\n\n" +
      "Key Terms of Employment\n" +
      "- Position: {{job_title}}\n" +
      "- Department: {{department}}\n" +
      "- Reporting Manager: {{manager_name}}\n" +
      "- Date of Joining: {{date_of_joining}}\n" +
      "- Work Location: {{work_location}}\n" +
      "- Annual CTC: {{annual_ctc}} as per the enclosed compensation structure\n" +
      "- Employment Type: {{employment_type}}\n\n" +
      "This offer is contingent upon successful completion of background verification, submission of required " +
      "documents, and satisfactory reference checks. Kindly confirm your acceptance by signing and returning a " +
      "copy of this letter on or before {{acceptance_deadline}}.\n\n" +
      "We look forward to welcoming you to the {{company_name}} team.\n\n" +
      "For {{company_name}}",
  },
  {
    slug: "appointment-letter",
    title: "Appointment Letter",
    icon: "📝",
    subject: "Letter of Appointment",
    toWhomsoever: false,
    fields: [
      { key: "offer_date", label: "Offer Date", type: "date" },
      { key: "job_title", label: "Job Title", type: "text" },
      { key: "date_of_joining", label: "Date of Joining", type: "date" },
      { key: "probation_period", label: "Probation Period", type: "text", default: "3 months" },
      { key: "working_hours", label: "Working Hours", type: "text", default: "9:30 AM – 6:30 PM, Monday to Saturday" },
      { key: "notice_period", label: "Notice Period", type: "text", default: "30 days" },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "Further to your acceptance of our offer dated {{offer_date}}, we are pleased to confirm your appointment " +
      "as {{job_title}} with {{company_name}}, effective from {{date_of_joining}}.\n\n" +
      "Terms & Conditions of Appointment\n" +
      "- Probation Period: {{probation_period}}, subject to satisfactory performance review\n" +
      "- Working Hours: {{working_hours}}\n" +
      "- Compensation: As detailed in Annexure A (Salary Structure)\n" +
      "- Leave Entitlement: As per the Company Leave Policy\n" +
      "- Notice Period: {{notice_period}} on either side post confirmation\n" +
      "- Confidentiality: You shall maintain strict confidentiality of all proprietary and business information\n" +
      "- Code of Conduct: You are required to adhere to the Company's Code of Conduct and Policies at all times\n\n" +
      "This appointment is subject to the Company's policies and service rules as amended from time to time. " +
      "Please sign and return the duplicate copy of this letter as a token of your acceptance.\n\n" +
      "For {{company_name}}",
  },
  {
    slug: "experience-certificate",
    title: "Experience Certificate",
    icon: "📜",
    subject: "",
    toWhomsoever: true,
    fields: [
      { key: "employee_id", label: "Employee ID", type: "text" },
      { key: "job_title", label: "Job Title", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "date_of_joining", label: "Date of Joining", type: "date" },
      { key: "date_of_leaving", label: "Date of Leaving", type: "date" },
      { key: "role_description", label: "Role / Responsibilities (brief)", type: "textarea" },
    ],
    bodyTemplate:
      "This is to certify that {{employee_name}} (Employee ID: {{employee_id}}) was employed with " +
      "{{company_name}} as {{job_title}} in the {{department}} from {{date_of_joining}} to {{date_of_leaving}}.\n\n" +
      "During the tenure, {{employee_name}} was found to be sincere, hardworking, and demonstrated a professional " +
      "attitude towards work. Their key responsibilities included {{role_description}}.\n\n" +
      "We wish them success in all future endeavors.\n\n" +
      "This certificate is issued upon the request of the employee for record purposes.\n\n" +
      "For {{company_name}}",
  },
  {
    slug: "relieving-letter",
    title: "Relieving Letter",
    icon: "🚪",
    subject: "Relieving Letter",
    toWhomsoever: false,
    fields: [
      { key: "resignation_date", label: "Resignation Date", type: "date" },
      { key: "last_working_day", label: "Last Working Day", type: "date" },
      { key: "settlement_days", label: "Full & Final Settlement Within (days)", type: "text", default: "45 days" },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This is with reference to your resignation letter dated {{resignation_date}} and your subsequent notice " +
      "period. We hereby confirm that you have been relieved from the services of {{company_name}}, effective " +
      "from the close of business on {{last_working_day}}.\n\n" +
      "Your full and final settlement will be processed within {{settlement_days}} from your last working day, " +
      "subject to the completion of the exit formalities and handover process.\n\n" +
      "We thank you for your contribution during your tenure with us and wish you the very best in your future " +
      "career.\n\n" +
      "Please treat this letter as your official relieving letter for all purposes.\n\n" +
      "For {{company_name}}",
  },
  {
    slug: "salary-certificate",
    title: "Salary Certificate",
    icon: "💵",
    subject: "",
    toWhomsoever: true,
    fields: [
      { key: "employee_id", label: "Employee ID", type: "text" },
      { key: "job_title", label: "Job Title", type: "text" },
      { key: "date_of_joining", label: "Date of Joining", type: "date" },
      { key: "basic_salary", label: "Basic Salary (INR)", type: "text" },
      { key: "hra", label: "House Rent Allowance (INR)", type: "text" },
      { key: "special_allowance", label: "Special Allowance (INR)", type: "text" },
      { key: "other_allowances", label: "Other Allowances (INR)", type: "text" },
      { key: "gross_salary", label: "Gross Monthly Salary (INR)", type: "text" },
      { key: "purpose", label: "Purpose", type: "text", default: "visa application" },
    ],
    bodyTemplate:
      "This is to certify that {{employee_name}} (Employee ID: {{employee_id}}) is employed with {{company_name}} " +
      "as {{job_title}} since {{date_of_joining}}.\n\n" +
      "Their current monthly salary details are as follows:\n" +
      "- Basic Salary: INR {{basic_salary}}\n" +
      "- House Rent Allowance (HRA): INR {{hra}}\n" +
      "- Special Allowance: INR {{special_allowance}}\n" +
      "- Other Allowances: INR {{other_allowances}}\n" +
      "- Gross Monthly Salary: INR {{gross_salary}}\n\n" +
      "This certificate is issued at the request of the employee for {{purpose}}.\n\n" +
      "For {{company_name}}",
  },
  {
    slug: "warning-letter",
    title: "Warning Letter",
    icon: "⚠️",
    subject: "Warning Letter regarding {{issue_type}}",
    toWhomsoever: false,
    fields: [
      { key: "issue_type", label: "Issue Type", type: "text", default: "Unsatisfactory Performance" },
      { key: "incident_description", label: "Incident / Behavior Description", type: "textarea" },
      { key: "date_period", label: "Date / Period", type: "text" },
      { key: "policy_clause", label: "Company Policy / Code of Conduct Clause Violated", type: "text" },
      { key: "corrective_action_1", label: "Corrective Action Expected (1)", type: "text" },
      { key: "corrective_action_2", label: "Corrective Action Expected (2)", type: "text" },
      { key: "response_days", label: "Improvement Expected Within (days)", type: "text", default: "15 days" },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This letter is being issued to formally bring to your attention {{incident_description}}, which occurred " +
      "on/during {{date_period}}.\n\n" +
      "This conduct is a violation of {{policy_clause}} and is not in line with the standards expected of " +
      "employees at {{company_name}}.\n\n" +
      "You are hereby directed to:\n" +
      "- {{corrective_action_1}}\n" +
      "- {{corrective_action_2}}\n\n" +
      "Please treat this letter as a formal warning. Any recurrence of similar conduct, or failure to show " +
      "improvement within {{response_days}}, may result in further disciplinary action, up to and including " +
      "termination of employment, in accordance with Company policy.\n\n" +
      "Please acknowledge receipt of this letter by signing below.\n\n" +
      "For {{company_name}}\n\n" +
      "Employee Acknowledgement: _______________________  Date: ___________",
  },
  // 2026-10-23 — "agar kisi employee ko MD ki taraf se notice mile ki 15 ya
  // 20 din me improvement nahi hua to terminate kar diya jayega ... ya
  // direct notice ki aapke paas 15 din hai": two dedicated notice letters,
  // separate from the existing Warning Letter (which is incident/conduct
  // based, tied to a policy clause) and Termination Letter (which is issued
  // AFTER the decision). Both are ordinary LETTER_TEMPLATES, so they use the
  // exact same form/preview/print/Word/Email/WhatsApp/record workflow as
  // every other HR letter, and both file under the existing 'Warning
  // Letter' enum value in letter-type-map.ts — no DB enum change, so no
  // migration has to be applied before they work.
  {
    slug: "improvement-notice",
    title: "Improvement Notice (15/20 Days)",
    icon: "⏳",
    subject: "Notice of Required Improvement in Work Performance",
    toWhomsoever: false,
    fields: [
      { key: "job_title", label: "Designation", type: "text" },
      { key: "issue_summary", label: "Performance Concern(s) Observed", type: "textarea" },
      { key: "improvement_area_1", label: "Improvement Required (1)", type: "text" },
      { key: "improvement_area_2", label: "Improvement Required (2)", type: "text" },
      {
        key: "review_days",
        label: "Notice Period Given",
        type: "select",
        options: ["15 days", "20 days", "30 days"],
        default: "15 days",
      },
      { key: "review_date", label: "Improvement Deadline (Review Date)", type: "date" },
      {
        key: "support_provided",
        label: "Support / Guidance to be Provided by Company",
        type: "text",
        default: "regular feedback and guidance from your reporting manager",
      },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This letter is issued on behalf of the Management of {{company_name}} with reference to your work " +
      "performance in the position of {{job_title}}.\n\n" +
      "It has been observed that your work performance has not been up to the standard expected from your " +
      "position, specifically: {{issue_summary}}. The matter has also been discussed with you earlier.\n\n" +
      "You are hereby given a notice period of {{review_days}} from the date of this letter, i.e. up to " +
      "{{review_date}}, to show a clear and measurable improvement in your work. During this period you are " +
      "specifically required to:\n" +
      "- {{improvement_area_1}}\n" +
      "- {{improvement_area_2}}\n\n" +
      "The Company will extend the necessary guidance and support, including {{support_provided}}. You are " +
      "expected to maintain regular attendance, complete the work assigned to you within the given timelines, " +
      "and keep your reporting manager informed of your progress.\n\n" +
      "Please note that if your work does not improve to the satisfaction of the Management within the said " +
      "period of {{review_days}}, the Management will have no option but to terminate your employment with " +
      "{{company_name}} without any further notice or reminder. This letter may therefore be treated as a " +
      "final opportunity to improve your performance.\n\n" +
      "We hope that you will take this notice seriously and make the required improvement.\n\n" +
      "Kindly acknowledge the receipt of this letter by signing the duplicate copy enclosed.\n\n" +
      "For {{company_name}}\n\n" +
      "Employee Acknowledgement: _______________________  Date: ___________",
  },
  {
    slug: "final-notice",
    title: "Final Notice (15 Days)",
    icon: "⏰",
    subject: "Final Notice regarding Continuation of Your Services",
    toWhomsoever: false,
    fields: [
      { key: "job_title", label: "Designation", type: "text" },
      { key: "performance_concern", label: "Reason / Performance Concern", type: "textarea" },
      {
        key: "notice_days",
        label: "Notice Given",
        type: "select",
        options: ["15 days", "20 days"],
        default: "15 days",
      },
      { key: "notice_end_date", label: "Notice Period Ends On (Last Working Day)", type: "date" },
      { key: "handover_contact", label: "Hand Over Pending Work To", type: "text" },
      { key: "settlement_days", label: "Full & Final Settlement Within (days)", type: "text", default: "45 days" },
      {
        key: "company_property",
        label: "Company Property to Return",
        type: "text",
        default: "laptop, ID card, access card",
      },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This letter is issued on behalf of the Management of {{company_name}}.\n\n" +
      "Despite the time and opportunities given to you to improve your work, your performance in the position " +
      "of {{job_title}} has not improved to the level expected by the Company. The specific concern is as " +
      "follows: {{performance_concern}}.\n\n" +
      "The Management has therefore decided that your services cannot be continued beyond the notice period. " +
      "You are hereby given a notice of {{notice_days}} from the date of this letter, ending on " +
      "{{notice_end_date}}. You will not be required to report for duty after that date.\n\n" +
      "During the notice period you are expected to:\n" +
      "- Continue your regular duties and complete all pending work\n" +
      "- Hand over all pending work, files and records to {{handover_contact}}\n" +
      "- Return all Company property in your possession, including {{company_property}}\n\n" +
      "Your full and final settlement will be processed within {{settlement_days}} from your last working day, " +
      "subject to completion of the exit formalities and handover. No further notice or reminder will be " +
      "issued to you in this regard.\n\n" +
      "We thank you for your service and wish you the best in your future endeavors.\n\n" +
      "For {{company_name}}\n\n" +
      "Employee Acknowledgement: _______________________  Date: ___________",
  },
  // 2026-10-23 — "ek vo letter bhi add karo ki company khud employee ke liye
  // notice deti hai 10, 15, 20, mahina, custom date ke according. Due to many
  // reasons add via dropdown — work related, behaviour and many more."
  //
  // This is the company's own notice TO the employee (with a notice period),
  // not the employee's resignation and not the after-the-fact Termination
  // Letter below — hence its own template. Notice period is a dropdown
  // (10/15/20 days, 1/2/3/6 months, or a custom period/date) and the reason
  // is a dropdown too (work related, behaviour, performance, absenteeism,
  // policy violation, insubordination, business requirement, other), with a
  // free-text detail box for the specifics. Entirely in English, like every
  // other letter here.
  {
    slug: "company-notice-letter",
    title: "Company Notice Letter (10 / 15 / 20 Days · Months)",
    icon: "📨",
    subject: "Formal Notice regarding Your Employment",
    toWhomsoever: false,
    fields: [
      { key: "job_title", label: "Designation", type: "text" },
      {
        key: "reason_category",
        label: "Reason for Notice",
        type: "select",
        options: [
          "Work related",
          "Behaviour / Conduct",
          "Performance",
          "Absenteeism",
          "Violation of Company Policy",
          "Insubordination",
          "Business / Operational Requirement",
          "Other (specified below)",
        ],
        default: "Work related",
      },
      {
        key: "reason_detail",
        label: "Reason Details (what exactly happened / why this notice is being given)",
        type: "textarea",
      },
      {
        key: "notice_period",
        label: "Notice Period",
        type: "select",
        options: ["10 days", "15 days", "20 days", "1 month", "2 months", "3 months", "6 months", "Custom period / date"],
        default: "15 days",
      },
      {
        key: "custom_notice_period",
        label: "Custom Notice Period (fill only if 'Custom period / date' is selected above)",
        type: "text",
      },
      { key: "notice_end_date", label: "Notice Ends On (Last Working Day)", type: "date" },
      { key: "handover_contact", label: "Hand Over Pending Work To", type: "text" },
      { key: "company_property", label: "Company Property to Return", type: "text", default: "laptop, ID card, access card, office keys" },
      { key: "settlement_days", label: "Full & Final Settlement Within (days)", type: "text", default: "45 days" },
    ],
    derive: (values) => ({
      notice_period_phrase:
        values.notice_period === "Custom period / date"
          ? values.custom_notice_period?.trim() || "as per the date mentioned below"
          : values.notice_period,
    }),
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This letter is issued by the Management of {{company_name}} and is served on you as a formal notice " +
      "in respect of your employment with the Company in the position of {{job_title}}.\n\n" +
      "Notice Details\n" +
      "- Notice period: {{notice_period_phrase}}\n" +
      "- Notice ends on (last working day): {{notice_end_date}}\n\n" +
      "Reason for this notice\n" +
      "- Category: {{reason_category}}\n" +
      "- Details: {{reason_detail}}\n\n" +
      "Your employment with {{company_name}} will accordingly come to an end at the close of business hours " +
      "on {{notice_end_date}}, and you will stand relieved from the services of the Company with effect from " +
      "that date. You will be paid your regular salary and allowances up to your last working day.\n\n" +
      "During the notice period you are required to:\n" +
      "- Continue to perform your regular duties as {{job_title}} with the same diligence and discipline as before\n" +
      "- Complete all pending work and hand over the same, along with all files and records, to {{handover_contact}}\n" +
      "- Return all Company property in your possession, including {{company_property}}\n" +
      "- Co-operate fully in the completion of the exit formalities\n\n" +
      "Your full and final settlement will be processed within {{settlement_days}} from your last working day, " +
      "subject to the completion of the handover and exit formalities.\n\n" +
      "This notice is issued in accordance with the terms of your appointment and the policies of the Company.\n\n" +
      "Kindly acknowledge receipt of this letter by signing the duplicate copy enclosed.\n\n" +
      "For {{company_name}}\n\n" +
      "Employee Acknowledgement: _______________________  Date: ___________",
  },
  {
    slug: "termination-letter",
    title: "Termination Letter",
    icon: "❌",
    subject: "Termination of Employment",
    toWhomsoever: false,
    fields: [
      { key: "job_title", label: "Job Title", type: "text" },
      { key: "termination_date", label: "Termination Date", type: "date" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "prior_process", label: "Reference to Prior Warnings / PIP / Due Process", type: "textarea" },
      { key: "settlement_days", label: "Full & Final Settlement Within (days)", type: "text", default: "45 days" },
      { key: "company_property", label: "Company Property to Return", type: "text", default: "laptop, ID card, access card" },
      { key: "handover_contact", label: "Hand Over Pending Work To", type: "text" },
    ],
    bodyTemplate:
      "Dear {{employee_name}},\n\n" +
      "This letter is to formally inform you that your employment with {{company_name}} as {{job_title}} is " +
      "being terminated with effect from {{termination_date}}, on account of {{reason}}.\n\n" +
      "This decision has been taken after {{prior_process}}.\n\n" +
      "Settlement & Formalities\n" +
      "- Full and final settlement will be processed within {{settlement_days}} of your last working day\n" +
      "- You are required to complete the exit formalities and return all Company property, including " +
      "{{company_property}}\n" +
      "- Your relieving/experience letter will be issued upon completion of the exit process\n\n" +
      "You are advised to hand over all pending work to {{handover_contact}} before your last working day.\n\n" +
      "We wish you the best in your future endeavors.\n\n" +
      "For {{company_name}}",
  },
];

export function findTemplate(slug: string): LetterTemplate | undefined {
  return LETTER_TEMPLATES.find((t) => t.slug === slug);
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `[${key}]`);
}

/**
 * 2026-10-23 — a <input type="date"> holds an ISO string ("2026-11-07"),
 * and that raw value used to be substituted straight into the letter body,
 * so a printed notice said "up to 2026-11-07". This is the readable form
 * used on letters and PDFs ("07 November 2026"); anything that isn't a
 * parseable ISO date is returned exactly as typed, so existing free-text
 * dates and older records are unaffected.
 */
export function formatLetterDate(value: string): string {
  if (!value) return value;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

// 2026-09-23 — the letter body editor (letter-form.tsx) switched from a
// plain <textarea> to a rich-text (HTML) editor so bold/bullets/alignment
// can be applied, but renderTemplate() above still returns a plain string
// with \n for line breaks (the templates themselves are plain text). This
// converts that plain output into the same "one <div> per line" shape a
// contentEditable area produces natively, so the rich editor starts from
// correctly-broken paragraphs instead of one run-on line — a blank line
// becomes an empty div (rendered as <br> so it doesn't collapse to zero
// height), matching how the templates use blank lines as paragraph gaps.
function escapeHtmlText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function plainTextToEditableHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "<div><br></div>" : `<div>${escapeHtmlText(line)}</div>`))
    .join("");
}

export { today as todayFormatted };

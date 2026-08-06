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

export type LetterFieldType = "text" | "textarea" | "date" | "number";

export type LetterField = {
  key: string;
  label: string;
  type: LetterFieldType;
  default?: string;
};

export type LetterTemplate = {
  slug: string;
  title: string;
  icon: string;
  subject: string; // may contain {{tokens}}
  toWhomsoever: boolean; // true = "TO WHOMSOEVER IT MAY CONCERN" (no addressee block)
  fields: LetterField[]; // template-specific fields, IN ADDITION to the common employee/date/ref fields
  bodyTemplate: string; // {{tokens}} substituted to build the initial editable body text
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

export { today as todayFormatted };

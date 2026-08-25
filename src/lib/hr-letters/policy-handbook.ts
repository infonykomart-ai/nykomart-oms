// Company Policy Handbook — docx section 8, exact wording ported (2026-08-06),
// [BRACKETED] placeholders filled with reasonable defaults where the source
// didn't already specify a concrete value. Static reference document, one
// per company (not per-employee) — always editable before print, same as
// every other letter in this module.
export function policyHandbookText(companyName: string): string {
  return `${companyName} — Company Policy Handbook

This handbook outlines the general Human Resource policies applicable to all employees of ${companyName}. Employees are expected to read, understand, and comply with these policies at all times.

8.1 Working Hours & Attendance
- Standard working hours are from 9:30 AM to 6:30 PM, Monday to Saturday.
- Employees are expected to record attendance daily via the biometric/HRMS system.
- Employees arriving later than 15 minutes beyond scheduled time on 3 occasions in a month may be marked as half-day/late, per Company discretion.

8.2 Leave Policy
- Casual Leave (CL): 12 days per year
- Sick Leave (SL): 7 days per year
- Earned/Privilege Leave (EL/PL): 15 days per year, accrued monthly
- Maternity Leave: As per the Maternity Benefit Act, 1961 (currently 26 weeks for eligible employees)
- Paternity Leave: 5 days, as per Company discretion
- Leave applications must be submitted through the HRMS/portal at least 2 days in advance, except in emergencies
- Unauthorized absence beyond 3 consecutive days without approval may be treated as job abandonment

8.3 Code of Conduct
- Employees must treat colleagues, clients, and stakeholders with respect, honesty, and professionalism at all times
- Discrimination, harassment, or bullying of any kind will not be tolerated
- Employees must avoid conflicts of interest and disclose any potential conflicts to their manager/HR
- Use of Company assets (laptop, email, internet) must be primarily for official purposes
- Confidential business, client, and employee information must not be disclosed to unauthorized parties

8.4 Prevention of Sexual Harassment (POSH)
- The Company maintains a zero-tolerance policy towards sexual harassment at the workplace, in accordance with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013
- An Internal Committee (IC) has been constituted to receive and address complaints; contact details are available with HR
- All complaints will be handled with strict confidentiality and without retaliation against the complainant

8.5 Compensation & Benefits
- Salaries are disbursed on or before the 7th of every month via bank transfer
- Statutory benefits include Provident Fund (PF), Employee State Insurance (ESI, if applicable), and Gratuity as per eligibility
- Performance-linked increments and bonuses, if any, are reviewed annually

8.6 Disciplinary Policy
- Violations of Company policy may result in a verbal warning, written warning, suspension, or termination, depending on severity
- The Company reserves the right to conduct an inquiry before taking disciplinary action
- Repeated or serious misconduct may lead to immediate termination without notice

8.7 Resignation & Exit Policy
- Employees must submit resignation in writing, with notice period as per their appointment letter (typically 30 days)
- Full and final settlement will be processed within 45 days of the last working day
- Exit interview and clearance (IT, Admin, Finance) is mandatory before relieving

8.8 Confidentiality Undertaking (Post-Employment)
I confirm and undertake that I shall maintain complete confidentiality of all company data, documents, customer information, business information, and other confidential material that came into my possession during the course of my employment with ${companyName}. I shall not copy, share, disclose, misuse, or leak any such company data to any person or third party, either during or after my employment.
I further agree that I shall not knowingly participate in, assist, or facilitate any activity that unlawfully misuses or causes harm to the company's confidential information or business interests.
I understand that these obligations shall survive the termination of my employment and shall continue to bind me as stated in the Company's letter(s) to me, and that any breach on my part may attract civil and/or criminal liability under applicable Indian law, including the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.

8.9 Amendments
${companyName} reserves the right to amend, modify, or withdraw any policy stated in this handbook at its sole discretion, with or without prior notice, as per business requirements and applicable law.

Acknowledged & Accepted by:
Employee Name: _______________________  Signature: _______________________  Date: ___________`;
}

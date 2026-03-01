export const TERMS_OF_USE = {
  title: "Aries AI Terms of Use",
  version: "1.1.0",
  updatedAt: "2026-02-28",
  content: [
    "By using this application, you agree to use the system lawfully and responsibly.",
    "Role hierarchy applies to all actions: founder > admin > staff > user.",
    "Founder can create admin and staff accounts and retains highest access, including terminal execution controls.",
    "Admin and founder accounts may issue integration access keys for founder/admin/staff accounts to connect Aries AI to external projects.",
    "You must not request, attempt, or encourage self-harm, suicide, violence, or harm against any person.",
    "The AI service enforces safety guardrails. Requests that appear to involve self-harm or violence are blocked and are not answered.",
    "When prohibited content is detected, the system creates a safety report that includes the message, time, and account identifier, and surfaces it in the admin reporting dashboard.",
    "Founder and admin accounts are responsible for reviewing reported incidents and taking appropriate action according to applicable law and policy; staff accounts may monitor reports as read-only reviewers.",
    "Operational incidents (service limits, key failures, backend outages) are logged to the report queue for admin/staff monitoring and are not exposed as raw technical errors to standard users.",
    "User accounts may be suspended or removed for repeated policy violations.",
    "Integration access keys are credentials with full account authority for allowed actions; protect them and rotate/revoke immediately if exposed.",
    "Founder terminal access is restricted to founder role and approved command prefixes, and command output may be logged for security review.",
    "Do not share secrets or credentials in chat content. Access keys and tokens must remain server-side.",
    "The service is provided as-is for local development and operational testing."
  ]
};

export const AI_GUIDELINES = {
  title: "Aries AI Safety and Usage Guidelines",
  updatedAt: "2026-02-28",
  sections: [
    {
      title: "Allowed Use",
      items: [
        "General Q&A, coding help, summarization, planning, and productivity tasks.",
        "Professional collaboration and research that does not involve harmful intent."
      ]
    },
    {
      title: "Disallowed Requests",
      items: [
        "Any request to commit suicide, self-harm, or encourage self-harm.",
        "Any request to hurt, kill, assault, or otherwise cause physical harm to anyone.",
        "Threat planning, weaponization guidance, or tactics for violent wrongdoing."
      ]
    },
    {
      title: "Enforcement",
      items: [
        "Disallowed prompts are blocked before model execution.",
        "Blocked prompts are logged as safety reports for admin review.",
        "Operational failures are logged to the report queue so admin/staff can monitor reliability issues.",
        "Founder and admin users can triage reports; staff users can monitor report queues.",
        "Integration-key requests are attributed to the key owner account for reporting and audit purposes."
      ]
    },
    {
      title: "Role Permissions",
      items: [
        "Founder: all permissions, account management across roles, integration key management across accounts, and founder terminal access.",
        "Admin: report triage, user/staff creation, own integration key management.",
        "Staff (monitor): report viewing and own integration key management.",
        "User: chat access only."
      ]
    }
  ]
};

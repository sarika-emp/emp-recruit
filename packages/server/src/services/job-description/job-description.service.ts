// ============================================================================
// AI JOB DESCRIPTION GENERATOR SERVICE
// Generates job descriptions from basic inputs using templates.
// Optionally uses the shared LLM service (any configured provider) — falls back
// to the deterministic template when no LLM key is configured.
// ============================================================================

import { logger } from "../../utils/logger";
import { llmService } from "../ai/llm.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JDInput {
  title: string;
  department?: string;
  seniority: "intern" | "junior" | "mid" | "senior" | "lead" | "director" | "vp" | "c_level";
  skills: string[];
  location?: string;
  employment_type?: string;
  salary_range?: string;
  company_description?: string;
}

export interface GeneratedJD {
  overview: string;
  responsibilities: string[];
  requirements: string[];
  nice_to_have: string[];
  benefits: string[];
  full_description: string;
}

// ---------------------------------------------------------------------------
// Seniority-based templates
// ---------------------------------------------------------------------------

const SENIORITY_CONTEXT: Record<string, { years: string; prefix: string; focus: string }> = {
  intern: {
    years: "0 years",
    prefix: "Intern",
    focus: "learning and gaining hands-on experience",
  },
  junior: {
    years: "0-2 years",
    prefix: "Junior",
    focus: "building foundational skills and contributing to team projects",
  },
  mid: {
    years: "3-5 years",
    prefix: "",
    focus: "independently delivering high-quality work and mentoring junior team members",
  },
  senior: {
    years: "5-8 years",
    prefix: "Senior",
    focus: "leading technical initiatives and driving architectural decisions",
  },
  lead: {
    years: "7-10 years",
    prefix: "Lead",
    focus: "leading cross-functional teams and setting technical direction",
  },
  director: {
    years: "10-15 years",
    prefix: "Director of",
    focus: "strategic planning, team building, and organizational leadership",
  },
  vp: {
    years: "12+ years",
    prefix: "VP of",
    focus: "driving company-wide strategy and executive leadership",
  },
  c_level: {
    years: "15+ years",
    prefix: "Chief",
    focus: "setting organizational vision and driving transformative change",
  },
};

// Role-specific responsibility templates
const ROLE_RESPONSIBILITIES: Record<string, string[]> = {
  engineer: [
    "Design, develop, and maintain scalable software solutions",
    "Write clean, well-tested, and documented code",
    "Participate in code reviews and provide constructive feedback",
    "Collaborate with product and design teams to deliver features",
    "Troubleshoot and resolve production issues promptly",
    "Contribute to system architecture and technical decision-making",
    "Optimize application performance and reliability",
  ],
  designer: [
    "Create intuitive and visually appealing user interfaces",
    "Conduct user research and usability testing",
    "Develop wireframes, prototypes, and high-fidelity designs",
    "Collaborate with engineering teams to ensure design fidelity",
    "Maintain and evolve the design system",
    "Analyze user feedback and iterate on designs",
    "Stay current with design trends and best practices",
  ],
  product: [
    "Define product strategy and roadmap aligned with business goals",
    "Gather and prioritize requirements from stakeholders",
    "Write clear product specifications and user stories",
    "Work closely with engineering and design teams",
    "Analyze metrics and user data to inform product decisions",
    "Manage product backlog and sprint planning",
    "Conduct competitive analysis and market research",
  ],
  marketing: [
    "Develop and execute marketing strategies across channels",
    "Create compelling content and messaging",
    "Manage digital marketing campaigns and budgets",
    "Analyze campaign performance and optimize ROI",
    "Collaborate with sales and product teams on go-to-market plans",
    "Build and maintain brand identity and voice",
    "Track market trends and competitive landscape",
  ],
  sales: [
    "Identify and pursue new business opportunities",
    "Build and maintain strong client relationships",
    "Meet or exceed sales targets and quotas",
    "Conduct product demonstrations and presentations",
    "Negotiate contracts and close deals",
    "Maintain accurate CRM records and pipeline forecasts",
    "Collaborate with marketing and product teams on customer feedback",
  ],
  hr: [
    "Manage end-to-end recruitment processes",
    "Develop and implement HR policies and procedures",
    "Handle employee relations and conflict resolution",
    "Oversee onboarding and offboarding processes",
    "Manage compensation and benefits programs",
    "Ensure compliance with labor laws and regulations",
    "Drive employee engagement and retention initiatives",
  ],
  finance: [
    "Manage financial reporting and analysis",
    "Oversee budgeting and forecasting processes",
    "Ensure compliance with financial regulations",
    "Conduct financial modeling and scenario analysis",
    "Manage accounts payable and receivable",
    "Support audit processes and internal controls",
    "Provide strategic financial recommendations to leadership",
  ],
  operations: [
    "Streamline and optimize business processes",
    "Manage day-to-day operational activities",
    "Develop and implement standard operating procedures",
    "Monitor KPIs and drive continuous improvement",
    "Coordinate cross-functional initiatives",
    "Manage vendor relationships and contracts",
    "Ensure operational compliance and risk management",
  ],
  data: [
    "Build and maintain data pipelines and infrastructure",
    "Develop analytical models and dashboards",
    "Perform complex data analysis to drive business insights",
    "Ensure data quality, governance, and security",
    "Collaborate with stakeholders to understand data needs",
    "Design and implement data warehousing solutions",
    "Stay current with data engineering best practices and tools",
  ],
  default: [
    "Contribute to team objectives and organizational goals",
    "Collaborate with cross-functional teams",
    "Maintain high standards of quality in all deliverables",
    "Participate in continuous improvement initiatives",
    "Communicate effectively with stakeholders",
    "Stay current with industry trends and best practices",
    "Support team members and foster a positive work environment",
  ],
};

const STANDARD_BENEFITS = [
  "Competitive salary and equity package",
  "Comprehensive health, dental, and vision insurance",
  "Flexible working hours and remote work options",
  "Professional development budget and learning opportunities",
  "Paid time off and company holidays",
  "401(k) or equivalent retirement plan with company matching",
  "Team events, offsites, and wellness programs",
  "Modern office environment with latest tools and equipment",
];

// ---------------------------------------------------------------------------
// Role Detection
// ---------------------------------------------------------------------------

function detectRoleCategory(title: string): string {
  const lower = title.toLowerCase();

  if (/engineer|developer|programmer|swe|sde|devops|backend|frontend|fullstack|full.?stack|software/.test(lower))
    return "engineer";
  if (/design|ux|ui|graphic|creative/.test(lower)) return "designer";
  if (/product\s?(manager|owner|lead)|pm\b/.test(lower)) return "product";
  if (/market|growth|brand|seo|content\s?market|digital\s?market/.test(lower)) return "marketing";
  if (/sales|account\s?executive|bdm|business\s?development/.test(lower)) return "sales";
  if (/hr|human\s?resource|recruiter|talent|people\s?ops/.test(lower)) return "hr";
  if (/finance|accounting|controller|cfo|treasury/.test(lower)) return "finance";
  if (/operations|ops|supply\s?chain|logistics/.test(lower)) return "operations";
  if (/data|analytics|machine\s?learning|ml|ai\b|scientist/.test(lower)) return "data";

  return "default";
}

// ---------------------------------------------------------------------------
// Template-Based Generator
// ---------------------------------------------------------------------------

function generateFromTemplate(input: JDInput): GeneratedJD {
  const seniority = SENIORITY_CONTEXT[input.seniority] || SENIORITY_CONTEXT.mid;
  const roleCategory = detectRoleCategory(input.title);
  const responsibilities = ROLE_RESPONSIBILITIES[roleCategory] || ROLE_RESPONSIBILITIES.default;

  // Build the display title
  const displayTitle = input.title;

  // Overview
  const locationText = input.location ? ` based in ${input.location}` : "";
  const deptText = input.department ? ` within our ${input.department} team` : "";
  const overview = `We are looking for a talented ${displayTitle}${locationText}${deptText} to join our team. ` +
    `This role requires ${seniority.years} of experience and is focused on ${seniority.focus}. ` +
    `The ideal candidate is passionate about delivering exceptional results and thrives in a collaborative, fast-paced environment.`;

  // Responsibilities — pick 5-7 based on seniority and add skill-specific ones
  const selectedResponsibilities = responsibilities.slice(0, input.seniority === "intern" ? 4 : 6);

  // Add skill-specific responsibilities
  if (input.skills.length > 0) {
    const skillsList = input.skills.slice(0, 3).join(", ");
    selectedResponsibilities.push(
      `Apply expertise in ${skillsList} to solve challenging problems`,
    );
  }

  // If senior+, add leadership responsibilities
  if (["senior", "lead", "director", "vp", "c_level"].includes(input.seniority)) {
    selectedResponsibilities.push("Mentor and guide junior team members");
    if (["lead", "director", "vp", "c_level"].includes(input.seniority)) {
      selectedResponsibilities.push("Drive strategic technical decisions and roadmap planning");
    }
  }

  // Requirements
  const requirements: string[] = [
    `${seniority.years} of relevant professional experience`,
  ];

  if (input.skills.length > 0) {
    requirements.push(`Strong proficiency in ${input.skills.slice(0, 4).join(", ")}`);
    if (input.skills.length > 4) {
      requirements.push(`Experience with ${input.skills.slice(4, 7).join(", ")}`);
    }
  }

  requirements.push("Excellent communication and collaboration skills");
  requirements.push("Strong problem-solving abilities and attention to detail");

  if (["senior", "lead", "director", "vp", "c_level"].includes(input.seniority)) {
    requirements.push("Proven track record of leading projects or teams");
  }

  if (input.seniority !== "intern") {
    requirements.push("Bachelor's degree in a relevant field or equivalent practical experience");
  }

  // Nice-to-have
  const niceToHave: string[] = [
    "Experience working in a fast-paced startup or scale-up environment",
    "Familiarity with agile methodologies and practices",
  ];

  if (input.skills.length > 3) {
    niceToHave.push(`Advanced knowledge of ${input.skills[input.skills.length - 1]}`);
  }

  niceToHave.push("Strong portfolio or demonstrable track record of relevant work");
  niceToHave.push("Contributions to open-source projects or industry communities");

  // Benefits
  const benefits = STANDARD_BENEFITS.slice(0, 7);

  // Full description
  const full_description = [
    `## About the Role\n\n${overview}`,
    `## Responsibilities\n\n${selectedResponsibilities.map((r) => `- ${r}`).join("\n")}`,
    `## Requirements\n\n${requirements.map((r) => `- ${r}`).join("\n")}`,
    `## Nice to Have\n\n${niceToHave.map((r) => `- ${r}`).join("\n")}`,
    `## Benefits\n\n${benefits.map((b) => `- ${b}`).join("\n")}`,
  ].join("\n\n");

  return {
    overview,
    responsibilities: selectedResponsibilities,
    requirements,
    nice_to_have: niceToHave,
    benefits,
    full_description,
  };
}

// ---------------------------------------------------------------------------
// OpenAI Generator (optional)
// ---------------------------------------------------------------------------

// Shape the LLM is asked to return.
interface JDParsed {
  overview: string;
  responsibilities: string[];
  requirements: string[];
  nice_to_have: string[];
  benefits: string[];
}

/**
 * Generate a JD via the shared LLM service. Returns null when no provider is
 * configured or the call fails/parses badly, so the caller falls back to the
 * deterministic template — identical behaviour to the previous inline OpenAI
 * path, but now routed through the one wrapper every AI agent shares.
 *
 * @param orgId  tenant tag for cost/audit attribution.
 */
async function generateWithLLM(input: JDInput, orgId: number): Promise<GeneratedJD | null> {
  const prompt = `Generate a professional job description for the following position:

Title: ${input.title}
Department: ${input.department || "Not specified"}
Seniority: ${input.seniority}
Key Skills: ${input.skills.join(", ")}
Location: ${input.location || "Not specified"}
Employment Type: ${input.employment_type || "Full-time"}

Return a JSON object with these fields:
- overview (string): 2-3 sentence overview of the role
- responsibilities (string[]): 6-8 key responsibilities
- requirements (string[]): 5-7 must-have requirements
- nice_to_have (string[]): 3-5 nice-to-have qualifications
- benefits (string[]): 5-7 benefits

Return ONLY valid JSON, no markdown wrapping.`;

  const result = await llmService.completeJson<JDParsed>(
    { organizationId: orgId, feature: "jd-generator" },
    [{ role: "user", content: prompt }],
    {
      tier: "balanced",
      system: "You are an expert HR copywriter who creates compelling job descriptions.",
      temperature: 0.7,
      maxTokens: 2000,
    },
  );
  if (!result) return null;

  const parsed = result.parsed;
  // Defensive: the model must return the fields we render.
  if (!parsed?.overview || !Array.isArray(parsed.responsibilities)) return null;

  const full_description = [
    `## About the Role\n\n${parsed.overview}`,
    `## Responsibilities\n\n${(parsed.responsibilities || []).map((r) => `- ${r}`).join("\n")}`,
    `## Requirements\n\n${(parsed.requirements || []).map((r) => `- ${r}`).join("\n")}`,
    `## Nice to Have\n\n${(parsed.nice_to_have || []).map((r) => `- ${r}`).join("\n")}`,
    `## Benefits\n\n${(parsed.benefits || []).map((b) => `- ${b}`).join("\n")}`,
  ].join("\n\n");

  return {
    overview: parsed.overview,
    responsibilities: parsed.responsibilities,
    requirements: parsed.requirements,
    nice_to_have: parsed.nice_to_have,
    benefits: parsed.benefits,
    full_description,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a job description from basic inputs.
 * Uses OpenAI if OPENAI_API_KEY is set, otherwise falls back to templates.
 */
export async function generateJobDescription(
  input: JDInput,
  orgId: number = 0,
): Promise<GeneratedJD & { source: "ai" | "template" }> {
  // Try the shared LLM service first (returns null if no provider/key or on
  // failure). Threads orgId for tenant-tagged cost/audit; 0 = system/unattributed.
  const aiResult = await generateWithLLM(input, orgId);
  if (aiResult) {
    logger.info(`Job description generated via LLM for: ${input.title}`);
    return { ...aiResult, source: "ai" };
  }

  // Fallback to deterministic template-based generation (also the keyless path).
  const templateResult = generateFromTemplate(input);
  logger.info(`Job description generated via template for: ${input.title}`);
  return { ...templateResult, source: "template" };
}

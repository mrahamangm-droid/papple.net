import { BRAND } from "./brand";

export interface LegalSection { id: string; title: string; body: string[] }
export interface LegalDoc { title: string; description: string; sections: LegalSection[] }

const co = BRAND.company;

export const LEGAL_PAGES: Record<"terms" | "privacy" | "cookies" | "marketplace-rules", LegalDoc> = {
  terms: {
    title: "Terms of Service",
    description: `The terms for using ${BRAND.name}, the professional marketplace operated by ${co}.`,
    sections: [
      { id: "who", title: "Who we are and what Papple is", body: [
        `${BRAND.name} is an online marketplace operated by ${co}. We connect people and businesses who need work done with professionals and companies who offer it.`,
        "Papple provides the platform. Papple is not the employer, agent, partner or co-venturer of any provider or client, and it does not supply the work itself.",
      ] },
      { id: "accounts", title: "Accounts", body: [
        "You must provide accurate information, keep your sign-in details secret and be legally able to enter a contract. You are responsible for activity on your account.",
        "Administrators and staff accounts must use a second sign-in factor. We may suspend an account or organisation that breaks these terms or the marketplace rules.",
      ] },
      { id: "contracts", title: "Contracts between clients and providers", body: [
        "When a client accepts a proposal, the client and the provider form a contract with each other. Papple is not a party to that contract and does not guarantee the quality, timing or outcome of any work.",
        "Scope, price and milestones are set in the contract on the platform. Changes must be agreed there so both sides have a record.",
      ] },
      { id: "payments", title: "Payments and fees", body: [
        "Payments are processed by Stripe. Papple does not hold funds in its own account as a bank or payment institution, and it does not hold client money outside the payment provider's systems.",
        "Papple charges a platform fee. The total you pay is shown at checkout. Fees, taxes and payment-provider charges can differ by country.",
      ] },
      { id: "disputes", title: "Disputes and refunds", body: [
        "If a client and provider disagree about a milestone, either side can open a dispute on the platform. Papple staff review the evidence both sides provide and decide the outcome. The possible outcomes are to continue the contract, to mark it complete, to cancel it, or to cancel it and refund the contract's successful payments.",
        "A refund ruling covers every successful payment on that contract and cancels it. A decision does not remove either side's legal rights.",
      ] },
      { id: "reviews", title: "Reviews", body: [
        "After a contract ends, each side can review the other. Reviews are blind: neither review is shown until both are submitted or the review period ends. Reviews must be honest and about the work, and we may remove ones that break the marketplace rules.",
      ] },
      { id: "content", title: "Your content", body: [
        "You keep ownership of what you upload. You give Papple a limited licence to store, display and deliver it so the service works, for as long as it is on the platform.",
        "Intellectual property in finished work is governed by the contract between client and provider.",
      ] },
      { id: "liability", title: "Liability and changes", body: [
        "The platform is provided as available. To the extent the law allows, Papple is not liable for indirect or consequential loss, or for the acts of providers and clients. Nothing here limits liability that cannot be limited by law.",
        "We may update these terms. Material changes are announced on the platform before they apply.",
      ] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    description: `How ${co} collects, uses and protects personal data on ${BRAND.name}.`,
    sections: [
      { id: "controller", title: "Who is responsible", body: [
        `${co} operates ${BRAND.name} and decides how personal data is used on it. Contact details are at the end of this page.`,
      ] },
      { id: "collect", title: "What we collect", body: [
        "Account data such as your name, email address and the profile information you choose to publish. Work data such as projects, proposals, messages, contracts, files and reviews. Payment status and identifiers from our payment provider; we do not store full card numbers.",
        "Technical data needed to run and secure the service, such as sign-in sessions and abuse-prevention records.",
      ] },
      { id: "use", title: "How we use it", body: [
        "To provide the marketplace, process contracts and payments, review disputes, prevent fraud and abuse, send service emails and meet legal duties. We do not sell personal data.",
        "Product analytics run only if you allow them in the consent notice.",
      ] },
      { id: "processors", title: "Who we share it with", body: [
        "Service providers that run the platform for us: Vercel for hosting, Supabase for database and sign-in, Stripe for payments and payouts, Resend for transactional email, Cloudflare R2 for file storage, Sentry for error monitoring, and Upstash for abuse prevention (rate limits). PostHog provides analytics only if you allow them. Anthropic provides the optional AI assistant described below. Where a feature requires it, they receive only the data needed.",
        "Other users see what you choose to publish and what a contract requires. Authorities receive data only when the law requires it.",
      ] },
      { id: "ai", title: "The AI assistant (optional)", body: [
        "Where it is switched on, you can ask the AI assistant to draft or improve text, such as a proposal, a profile summary, a service description or a project brief. It is never required and never acts for you: you read, edit and send the text yourself.",
        "When you use it, Anthropic receives only the text you submit for that request, plus the project or profile details needed to write it. We never send chat messages to it. We record that a request happened and how large it was, to apply usage limits, but we do not store the text you sent or the answer you received.",
      ] },
      { id: "keep", title: "How long we keep it", body: [
        "We keep account and contract records while your account is active and for as long as needed for accounting, dispute and legal reasons. Ask us if you want a specific record deleted; we will say what must be kept and why.",
      ] },
      { id: "rights", title: "Your rights", body: [
        "Subject to applicable law you can ask to access, correct, export or delete your personal data, and to object to or restrict some processing. Some records must be kept by law, and we will explain when that applies.",
      ] },
      { id: "security", title: "Security and transfers", body: [
        "Data is encrypted in transit, access is limited by role and row-level rules in the database, and administrative actions are logged. Our providers may process data outside your country; we use contractual safeguards where the law requires them.",
      ] },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    description: `The cookies and similar storage ${BRAND.name} uses, and how to control them.`,
    sections: [
      { id: "what", title: "What this covers", body: [
        "Cookies and browser storage are small pieces of data saved on your device. This page lists what Papple uses and why.",
      ] },
      { id: "essential", title: "Essential storage", body: [
        "Sign-in session cookies keep you logged in and protect your account. They are essential, so they do not need consent and cannot be switched off while you use the service.",
        "We also keep your consent choice in your browser so we do not ask again each visit.",
      ] },
      { id: "analytics", title: "Analytics (optional)", body: [
        "If analytics are enabled on the platform, they start only after you press Allow in the consent notice. If you choose No thanks, or you do not answer, no analytics run.",
        "You can change your mind by clearing this site's data in your browser; the notice then appears again.",
      ] },
      { id: "advertising", title: "Advertising", body: [
        "Papple does not use advertising or cross-site tracking cookies.",
      ] },
      { id: "control", title: "Browser controls", body: [
        "You can block or delete cookies in your browser settings. Blocking essential cookies means you will not be able to sign in.",
      ] },
    ],
  },
  "marketplace-rules": {
    title: "Marketplace Rules",
    description: `What is and is not allowed on ${BRAND.name}, and how we enforce it.`,
    sections: [
      { id: "honesty", title: "Be honest", body: [
        "Describe yourself, your skills and your work accurately. Do not impersonate others, invent credentials or post fake reviews.",
      ] },
      { id: "prohibited", title: "Not allowed", body: [
        "Illegal services, harassment or hate, malware or hacking for harm, adult exploitation, spam, and work that infringes someone else's rights.",
        "Moving a contract off the platform to avoid fees while using Papple to find the client or provider is not allowed.",
      ] },
      { id: "reviews", title: "Reviews and ratings", body: [
        "Reviews must reflect real work you were part of. Offering or demanding payment, favours or threats in exchange for a review is not allowed.",
      ] },
      { id: "reporting", title: "Reporting", body: [
        "Use Report on a profile, service or project. A reviewer from Papple staff looks at each report; reports can be dismissed or lead to the content being hidden.",
      ] },
      { id: "enforcement", title: "What happens next", body: [
        "We may hide content, suspend an account or organisation, or end access. Staff record a reason for each such action. If you think a decision was wrong, contact us using the details on this page.",
      ] },
      { id: "verification", title: "Verified providers", body: [
        "A Verified badge means Papple staff reviewed the evidence the provider submitted. It is not a guarantee of work quality.",
      ] },
    ],
  },
};

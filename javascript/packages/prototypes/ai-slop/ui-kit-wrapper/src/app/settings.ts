import type { SelectOption } from "@ui";

type Settings = {
  workspaceName: string;
  slug: string;
  contactEmail: string;
  region: string;
  visibility: string;
  plan: string;
  seats: string;
  notifyDeploys: boolean;
  notifyMentions: boolean;
  notifyDigest: boolean;
  notifyBilling: boolean;
};

const regions: SelectOption[] = [
  { value: "eu-central", label: "EU · Frankfurt" },
  { value: "eu-west", label: "EU · Dublin" },
  { value: "us-east", label: "US · Virginia" },
  { value: "us-west", label: "US · Oregon" },
  { value: "ap-south", label: "AP · Singapore" },
  { value: "sa-east", label: "SA · São Paulo (waitlist)", disabled: true },
];

const visibilities: SelectOption[] = [
  { value: "private", label: "Private — invited members only" },
  { value: "org", label: "Organisation — anyone with an account" },
  { value: "public", label: "Public — anyone with the link" },
];

const plans: SelectOption[] = [
  { value: "starter", label: "Starter — €0 / month" },
  { value: "team", label: "Team — €29 / seat / month" },
  { value: "business", label: "Business — €59 / seat / month" },
];

const initialSettings: Settings = {
  workspaceName: "Northwind Studio",
  slug: "northwind-studio",
  contactEmail: "ops@northwind.example",
  region: "eu-central",
  visibility: "org",
  plan: "team",
  seats: "12",
  notifyDeploys: true,
  notifyMentions: true,
  notifyDigest: false,
  notifyBilling: true,
};

/**
 * Validation lives in the app, not in the kit.
 *
 * The Base UI kit can validate on its own via `Field.Root validate`. Using it
 * would make the contract depend on that engine, and the studio kit has no
 * equivalent. The app produces the message; the kit only shows it.
 */
function slugError(slug: string): string | undefined {
  if (slug.trim() === "") {
    return "A workspace URL is required.";
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "Use lowercase letters, numbers, and hyphens only.";
  }
  return undefined;
}

export { initialSettings, plans, regions, slugError, visibilities };
export type { Settings };

import type { WidgetDefinition } from "../../types";
import { BlockHead, bool, list, money, num, PAYMENTS, sample, str } from "./shared";

const authForm: WidgetDefinition = {
  type: "auth-form",
  name: "Login / register",
  category: "account",
  glyph: "🔐",
  description: "Account form with social sign-in and legal note.",
  fields: [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: [
        { value: "login", label: "Login" },
        { value: "register", label: "Register" },
      ],
    },
    { key: "title", label: "Title", type: "text" },
    { key: "showSocial", label: "Social buttons", type: "boolean" },
    { key: "showPromoCode", label: "Promo code field", type: "boolean" },
    { key: "note", label: "Legal note", type: "text" },
  ],
  defaults: {
    mode: "register",
    title: "Open your account",
    showSocial: true,
    showPromoCode: true,
    note: "By joining you confirm you are 18 or over and accept the terms.",
  },
  render: (props) => {
    const isRegister = str(props, "mode", "register") === "register";
    const fields = isRegister
      ? ["Email", "Password", "Date of birth", "Country"]
      : ["Email or username", "Password"];

    return (
      <div className="sb-block sb-auth">
        <div className="sb-auth__title">{str(props, "title")}</div>
        {fields.map((field) => (
          <div key={field} className="sb-auth__field">
            {field}
          </div>
        ))}
        {isRegister && bool(props, "showPromoCode") ? <div className="sb-auth__field">Promo code (optional)</div> : null}
        <span className="sb-btn sb-btn--brand sb-btn--block">{isRegister ? "Create account" : "Log in"}</span>
        {bool(props, "showSocial") ? (
          <div className="sb-auth__social">
            {["Google", "Apple", "Facebook"].map((provider) => (
              <span key={provider} className="sb-auth__provider">
                {provider}
              </span>
            ))}
          </div>
        ) : null}
        <div className="sb-auth__note">{str(props, "note")}</div>
      </div>
    );
  },
};

const accountSummary: WidgetDefinition = {
  type: "account-summary",
  name: "Account summary",
  category: "account",
  glyph: "👤",
  description: "Balance, bonus and open bets at a glance.",
  fields: [
    { key: "username", label: "Username", type: "text" },
    { key: "balance", label: "Balance", type: "number", step: 10 },
    { key: "bonus", label: "Bonus", type: "number", step: 5 },
    { key: "openBets", label: "Open bets", type: "number", step: 1 },
    { key: "currency", label: "Currency", type: "text" },
    { key: "showActions", label: "Deposit / withdraw", type: "boolean" },
  ],
  defaults: {
    username: "alex_k",
    balance: 1240.5,
    bonus: 30,
    openBets: 3,
    currency: "€",
    showActions: true,
  },
  render: (props) => {
    const currency = str(props, "currency", "€");

    return (
      <div className="sb-block sb-account">
        <div className="sb-account__head">
          <span className="sb-account__avatar">{str(props, "username", "a").slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="sb-account__name">{str(props, "username")}</div>
            <div className="sb-account__tier">Gold tier</div>
          </div>
        </div>
        <div className="sb-account__stats">
          {[
            { label: "Balance", value: money(num(props, "balance", 0), currency) },
            { label: "Bonus", value: money(num(props, "bonus", 0), currency) },
            { label: "Open bets", value: String(num(props, "openBets", 0)) },
          ].map((stat) => (
            <div key={stat.label} className="sb-account__stat">
              <span className="sb-account__stat-value">{stat.value}</span>
              <span className="sb-account__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
        {bool(props, "showActions") ? (
          <div className="sb-account__actions">
            <span className="sb-btn sb-btn--brand">Deposit</span>
            <span className="sb-btn sb-btn--ghost">Withdraw</span>
          </div>
        ) : null}
      </div>
    );
  },
};

const paymentsStrip: WidgetDefinition = {
  type: "payments-strip",
  name: "Payment methods",
  category: "account",
  glyph: "💳",
  description: "Accepted deposit methods with limits copy.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "count", label: "Methods", type: "range", min: 3, max: 8, step: 1 },
    { key: "note", label: "Note", type: "text" },
  ],
  defaults: {
    title: "Deposit in seconds",
    count: 6,
    note: "Minimum €10 · Withdrawals processed within 2 hours",
  },
  render: (props) => (
    <div className="sb-block sb-pay">
      <BlockHead title={str(props, "title")} icon="💳" />
      <div className="sb-pay__row">
        {sample(PAYMENTS, num(props, "count", 6)).map((method, index) => (
          <span key={`${method}-${index}`} className="sb-pay__badge">
            {method}
          </span>
        ))}
      </div>
      <div className="sb-pay__note">{str(props, "note")}</div>
    </div>
  ),
};

const responsibleGaming: WidgetDefinition = {
  type: "responsible-gaming",
  name: "Responsible gaming",
  category: "account",
  glyph: "🛡",
  description: "Safer gambling tools and regulator badges.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "tools", label: "Tools", type: "text", hint: "Comma separated" },
    { key: "showBadges", label: "Regulator badges", type: "boolean" },
  ],
  defaults: {
    title: "Stay in control",
    body: "Set a deposit limit, take a time-out or self-exclude at any moment from your account settings.",
    tools: "Deposit limits, Reality check, Time-out, Self-exclusion",
    showBadges: true,
  },
  render: (props) => (
    <div className="sb-safe">
      <div className="sb-safe__title">
        <span className="sb-safe__icon">🛡</span>
        {str(props, "title")}
      </div>
      <p className="sb-safe__body">{str(props, "body")}</p>
      <div className="sb-safe__tools">
        {list(props, "tools").map((tool) => (
          <span key={tool} className="sb-chip">
            {tool}
          </span>
        ))}
      </div>
      {bool(props, "showBadges") ? (
        <div className="sb-safe__badges">
          {["18+", "GamCare", "BeGambleAware", "MGA"].map((badge) => (
            <span key={badge} className="sb-safe__badge">
              {badge}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  ),
};

const ACCOUNT_WIDGETS: WidgetDefinition[] = [authForm, accountSummary, paymentsStrip, responsibleGaming];

export { ACCOUNT_WIDGETS };

// Single source of truth for subscription plans — amounts in paise (INR × 100)
const SUBSCRIPTION_PLANS = {
  monthly: {
    amount: 30000,        // ₹300
    durationInDays: 30,
    label: "1 Month",
  },
  quarterly: {
    amount: 60000,        // ₹600
    durationInDays: 90,
    label: "3 Months",
  },
  yearly: {
    amount: 120000,       // ₹1200
    durationInDays: 365,
    label: "12 Months",
  },
};

const getPlan = (key) => SUBSCRIPTION_PLANS[key] || null;
const isValidPlanKey = (key) => key in SUBSCRIPTION_PLANS;

module.exports = { SUBSCRIPTION_PLANS, getPlan, isValidPlanKey };

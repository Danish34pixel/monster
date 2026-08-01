const TRIAL_DURATION_DAYS = 90;
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

function computeTrialEndDate(trialStartDate) {
  return new Date(new Date(trialStartDate).getTime() + TRIAL_DURATION_MS);
}

// Returns whether a user/purchaser doc is inside its 90-day trial window.
// `applicable: false` means this doc predates the trial feature (no
// trialStartDate) and should be left to whatever gate already governs it
// (accountStatus / subscriptionEndDate) rather than being forced into trial
// logic it never opted into.
function checkTrialStatus(user) {
  if (!user || !user.trialStartDate) {
    return {
      applicable: false,
      trialActive: false,
      paymentRequired: false,
      trialEndDate: null,
    };
  }

  const trialEndDate = user.trialEndDate
    ? new Date(user.trialEndDate)
    : computeTrialEndDate(user.trialStartDate);

  const trialActive = Date.now() < trialEndDate.getTime();

  return {
    applicable: true,
    trialActive,
    paymentRequired: !trialActive,
    trialEndDate,
  };
}

module.exports = {
  TRIAL_DURATION_DAYS,
  TRIAL_DURATION_MS,
  computeTrialEndDate,
  checkTrialStatus,
};

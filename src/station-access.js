/** Keep a preview usable until paid checkout is actually configured. */
export function isStationAccessAllowed({
  contestAccess = false,
  passContractConfigured = false,
  passExpiry = 0,
  nowMs = Date.now(),
} = {}) {
  return Boolean(contestAccess || !passContractConfigured || Number(passExpiry) > nowMs / 1000);
}

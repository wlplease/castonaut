export function isNotFound(error) {
  return Number(error?.status) === 404 || /\(404\)/i.test(String(error?.message || ''));
}

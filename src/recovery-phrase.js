/**
 * Read a phrase from its field, normalize it, and immediately clear the DOM
 * control before any async work begins. This reduces accidental exposure in
 * screenshots, browser autofill, and later user interactions. The application
 * does not retain the field value after this function returns; JavaScript
 * engines cannot guarantee memory zeroization.
 */
export function takeRecoveryPhrase(field) {
  const phrase = String(field?.value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (field) field.value = '';
  return phrase;
}

export function isSupportedRecoveryPhraseLength(phrase) {
  const count = String(phrase || '').split(' ').filter(Boolean).length;
  return [12, 15, 18, 21, 24].includes(count);
}




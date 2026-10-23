export function resultOrThrow(result, label) {
  if (!result || (typeof result.isErr === 'function' && result.isErr())) {
    throw new Error(`${label}: ${result?.error || 'could not create protocol message'}`);
  }
  return result.value ?? result;
}

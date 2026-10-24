export async function publishWithConfirmation({ lookup, submit, onStatus = () => {}, successText, waitForMerge }) {
  try {
    await lookup();
    onStatus(successText, 'success');
    return { alreadyMerged: true };
  } catch (error) {
    if (!error?.notFound) throw error;
  }

  let accepted;
  try {
    accepted = await submit();
  } catch (error) {
    if (await waitForMerge(3)) {
      onStatus(successText, 'success');
      return { alreadyMerged: true };
    }
    throw error;
  }
  onStatus('The app service accepted your message for relay. Waiting for network confirmation…', 'pending');
  if (!await waitForMerge(8)) throw new Error('The node accepted the message for relay, but merge is not confirmed yet. Try refresh in a moment.');
  onStatus(successText, 'success');
  return accepted;
}

export async function removeWithConfirmation({ lookup, submit, onStatus = () => {}, successText, waitForRemoval }) {
  try {
    await lookup();
  } catch (error) {
    if (!error?.notFound) throw error;
    onStatus(successText, 'success');
    return { alreadyRemoved: true };
  }
  try {
    await submit();
  } catch (error) {
    if (await waitForRemoval(3)) {
      onStatus(successText, 'success');
      return { alreadyRemoved: true };
    }
    throw error;
  }
  onStatus('Removal relayed. Waiting for Snapchain confirmation…', 'pending');
  if (!await waitForRemoval(8)) throw new Error('Removal was relayed but the node has not confirmed it yet. Check again before retrying.');
  onStatus(successText, 'success');
}

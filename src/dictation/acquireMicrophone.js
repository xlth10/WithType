// Acquisition can outlive cancellation or a component. Never publish stale resources.
export async function acquireMicrophone({ getUserMedia, createContext, isCurrent }) {
  let stream, context;
  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (context) Promise.resolve(context.close()).catch(() => {});
  };
  try {
    stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (!isCurrent()) { release(); return null; }
    context = createContext();
    if (context.state === "suspended") await context.resume();
    if (!isCurrent()) { release(); return null; }
    return { stream, context };
  } catch (error) {
    release();
    throw error;
  }
}

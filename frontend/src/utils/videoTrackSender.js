export const findVideoSender = (pc, knownSender) => (
  knownSender || pc.getSenders().find((sender) => sender.track?.kind === 'video') || null
);

export const replacePeerVideoTrack = async (pc, knownSender, videoTrack, stream) => {
  const sender = findVideoSender(pc, knownSender);
  if (sender) {
    await sender.replaceTrack(videoTrack);
    return sender;
  }

  return videoTrack ? pc.addTrack(videoTrack, stream) : null;
};

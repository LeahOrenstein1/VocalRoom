const button = document.querySelector<HTMLButtonElement>("#enable")!;
button.onclick = async () => {
  const ctx = new AudioContext();
  await ctx.resume();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate),
    data = buffer.getChannelData(0);
  let seed = 42;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const t = i / ctx.sampleRate;
    data[i] =
      ((seed / 2147483647) * 2 - 1) * 0.012 +
      (t % 2 > 0.3
        ? 0.2 * Math.sin(2 * Math.PI * 440 * t) +
          0.08 * Math.sin(2 * Math.PI * 880 * t)
        : 0);
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        await ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const destination = ctx.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        destination.stream.getTracks().forEach((track) =>
          track.addEventListener("ended", () => {
            try {
              source.stop();
            } catch {}
          }),
        );
        return destination.stream;
      },
      enumerateDevices: async () => [
        {
          deviceId: "synthetic",
          kind: "audioinput",
          label: "Synthetic singing test source",
          groupId: "test",
          toJSON() {
            return {};
          },
        },
      ],
    },
  });
  button.disabled = true;
  document.querySelector("#fixture-status")!.textContent =
    " Synthetic audio enabled. Recording uses the actual PCM AudioWorklet.";
  await import("../src/main");
};

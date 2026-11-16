import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
  MotionConfig,
} from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  AudioLines,
  Mic,
  Headphones,
  ShieldCheck,
  Plus,
  Play,
  Square,
  Download,
  FolderOpen,
  Save,
  X,
  Check,
  Sparkles,
  Volume2,
  Music2,
  RotateCcw,
} from "lucide-react";
import {
  audioContext,
  makeTrack,
  graph,
  duration,
  renderMix,
  encodeWav,
  download,
  saveProject,
  projects,
  loadProject,
  playRendered,
  type Track,
  type Mix,
  type Preset,
} from "./audio";
import {
  processSession,
  mixSignature,
  type ProcessedMix,
  type ProcessingProgress,
} from "./processing";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "./styles.css";
import { createPcmCapture, estimatedDelayMs, type PcmCapture } from "./capture";
const MicScene = lazy(() => import("./MicScene"));
function Magnetic({
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const x = useMotionValue(0),
    y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 17 }),
    sy = useSpring(y, { stiffness: 180, damping: 17 });
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (reduce || disabled) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = button.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = event.clientX - rect.left - rect.width / 2;
        const dy = event.clientY - rect.top - rect.height / 2;
        const near =
          Math.abs(dx) < rect.width / 2 + 35 &&
          Math.abs(dy) < rect.height / 2 + 35;
        x.set(near ? dx * 0.1 : 0);
        y.set(near ? dy * 0.14 : 0);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [reduce, disabled, x, y]);
  return (
    <motion.button
      ref={button}
      className={`magnetic ${className}`}
      disabled={disabled}
      onClick={onClick}
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.13);
        y.set((e.clientY - r.top - r.height / 2) * 0.2);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      whileTap={{ scale: 0.96 }}
    >
      {children}
    </motion.button>
  );
}
function Atmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        ref.current?.style.setProperty(
          "--mx",
          `${(e.clientX / window.innerWidth) * 100}%`,
        );
        ref.current?.style.setProperty(
          "--my",
          `${(e.clientY / window.innerHeight) * 100}%`,
        );
      });
    };
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className="atmosphere" aria-hidden="true">
      <div className="dust" />
    </div>
  );
}
function Waveform({ track, total }: { track: Track; total: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = 1200;
    c.height = 110;
    const a = track.buffer.getChannelData(0),
      bars = 420;
    ctx.fillStyle = track.kind === "backing" ? "#b9a2d5" : "#e9a6c2";
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const from = Math.floor(
        (track.trimStart + ((track.trimEnd - track.trimStart) * i) / bars) *
          track.buffer.sampleRate,
      );
      const end = Math.floor(
        (track.trimStart +
          ((track.trimEnd - track.trimStart) * (i + 1)) / bars) *
          track.buffer.sampleRate,
      );
      for (
        let j = from;
        j < end;
        j += Math.max(1, Math.floor((end - from) / 90))
      )
        peak = Math.max(peak, Math.abs(a[j] || 0));
      const h = Math.max(2, peak * 100);
      ctx.fillRect((i * 1200) / bars, 55 - h / 2, 1.7, h);
    }
  }, [track.buffer, track.trimStart, track.trimEnd, track.kind]);
  return (
    <canvas
      ref={ref}
      className="waveform"
      style={{
        marginLeft: `${(Math.max(0, track.offset) / total) * 100}%`,
        width: `${Math.min(100, ((track.trimEnd - track.trimStart) / total) * 100)}%`,
      }}
      aria-label={`${track.name} waveform`}
    />
  );
}
const time = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
export default function App() {
  const [page, setPage] = useState<"home" | "style" | "studio">("home");
  const [preset, setPreset] = useState<Preset>("Natural");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mix, setMix] = useState<Mix>({
    enabled: false,
    preset: "Natural",
    intensity: 0.6,
    noiseReduction: 0.65,
    autoMix: true,
    engine: "studio",
    levelMatch: true,
  });
  const [name, setName] = useState("Untitled session");
  const [projectId, setProjectId] = useState(crypto.randomUUID());
  const [modal, setModal] = useState<
    "projects" | "terms" | "reset" | "new" | null
  >(null);
  const [processed, setProcessed] = useState<ProcessedMix | null>(null);
  const [processing, setProcessing] = useState<ProcessingProgress | null>(null);
  const processingAbort = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<PcmCapture | null>(null);
  const activeStream = useRef<MediaStream | null>(null);
  const captureInfo = useRef({ from: 0, delayMs: 0 });
  const [delayEstimate, setDelayEstimate] = useState<number | null>(null);
  const stopGraph = useRef<((fade?: number) => void) | null>(null);
  const playingRef = useRef(false);
  const playRequest = useRef(0);
  const started = useRef(0);
  const playFrom = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = Math.max(duration(tracks), position);
  const signature = mixSignature(tracks, mix);
  const processedReady =
    processed !== null && processed.signature === signature;
  const processedSelected = mix.enabled && processedReady;
  const stageOrder = [
    "analysis",
    "noise",
    ...(mix.engine === "studio" ? ["vocal"] : []),
    "balance",
    "render",
    ...(mix.engine === "studio" ? ["master"] : []),
  ];
  const stageLabels: Record<string, string> = {
    analysis: "Analyze",
    noise: "Reduce noise",
    vocal: "Shape vocals",
    balance: "Balance tracks",
    render: "Render mix",
    master: "Finish & level-match",
  };
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [page]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not(:disabled),[role="dialog"] input,[role="dialog"] select',
          ),
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal]);
  const notify = (text: string) => {
    setMessage(text);
    setError("");
  };
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setMessage("");
  };
  function stop() {
    playRequest.current++;
    stopGraph.current?.(0.012);
    stopGraph.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
    playingRef.current = false;
  }
  function currentPosition() {
    return playingRef.current
      ? playFrom.current +
          Math.max(0, audioContext().currentTime - started.current)
      : position;
  }
  useEffect(
    () => () => {
      stopGraph.current?.();
      if (timer.current) clearInterval(timer.current);
      recorder.current?.dispose();
      activeStream.current?.getTracks().forEach((t) => t.stop());
      processingAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (tracks.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [tracks.length]);
  async function play(
    from = position,
    monitoring = false,
    useProcessed = processedSelected,
    sessionTracks = tracks,
    scheduledStart?: number,
    levelMatch = mix.levelMatch ?? true,
  ) {
    stop();
    const request = playRequest.current;
    const ctx = audioContext();
    await ctx.resume();
    if (request !== playRequest.current) return;
    started.current =
      scheduledStart ?? ctx.currentTime + (monitoring ? 0 : 0.015);
    playFrom.current = from;
    setPosition(from);
    stopGraph.current =
      useProcessed && processed && !monitoring
        ? playRendered(
            ctx,
            processed.buffer,
            ctx.destination,
            started.current,
            from,
            !monitoring && levelMatch && processedReady
              ? (processed.report?.processedComparisonGain ?? 1)
              : 1,
          )
        : graph(
            ctx,
            sessionTracks,
            { ...mix, enabled: false },
            ctx.destination,
            started.current,
            from,
            !monitoring && levelMatch && processedReady
              ? (processed.report?.originalComparisonGain ?? 1)
              : 1,
          );
    setPlaying(true);
    playingRef.current = true;
    timer.current = setInterval(() => {
      const p =
        playFrom.current + Math.max(0, ctx.currentTime - started.current);
      setPosition(p);
      const end =
        useProcessed && processed
          ? processed.buffer.duration
          : duration(sessionTracks) + 2;
      if (!monitoring && p >= end) {
        stop();
        setPosition(0);
      }
    }, 50);
  }
  const update = (id: string, patch: Partial<Track>) => {
    const next = tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setTracks(next);
    setMix((m) => ({ ...m, enabled: false }));
    if (playingRef.current) void play(currentPosition(), false, false, next);
  };
  function seekTo(next: number) {
    if (!Number.isFinite(next) || recording || busy) return;
    next = Math.max(0, next);
    if (playingRef.current) void play(next);
    else setPosition(next);
  }
  function compare(useProcessed: boolean, startListening = false) {
    if (useProcessed && !processedReady) return;
    const from = currentPosition();
    setMix((m) => ({ ...m, enabled: useProcessed }));
    if (playingRef.current || startListening)
      void play(from, false, useProcessed);
  }
  function changeMix(patch: Partial<Mix>) {
    setMix((m) => ({ ...m, ...patch, enabled: false }));
    if (playingRef.current) void play(currentPosition(), false, false);
  }
  async function processAudio() {
    stop();
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    processingAbort.current = controller;
    try {
      const result = await processSession(
        tracks,
        mix,
        setProcessing,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setProcessed(result);
      setMix((m) => ({ ...m, enabled: true }));
      setProcessing(null);
      setPosition(0);
      notify(
        "Your processed mix is ready. Compare it with the original — all source tracks are unchanged.",
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) fail(e);
    } finally {
      setProcessing(null);
      setBusy(false);
      processingAbort.current = null;
    }
  }
  function resetProject() {
    stop();
    setTracks([]);
    setProcessed(null);
    setProcessing(null);
    setPosition(0);
    setProjectId(crypto.randomUUID());
    setName("Untitled session");
    setMix({
      enabled: false,
      preset: "Natural",
      intensity: 0.6,
      noiseReduction: 0.65,
      autoMix: true,
      engine: "studio",
      levelMatch: true,
    });
    setRights(false);
    setModal(null);
    setPage("studio");
    setDelayEstimate(null);
    notify("A fresh session. Your saved projects are still in My projects.");
  }
  function newProject() {
    if (tracks.length) setModal("new");
    else resetProject();
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 120 * 1024 * 1024)
        throw new Error("Please choose an audio file smaller than 120 MB.");
      const buffer = await audioContext().decodeAudioData(
        await file.arrayBuffer(),
      );
      stop();
      setTracks((ts) => [...ts, makeTrack(file.name, buffer, "backing")]);
      notify(
        "Backing track imported. Put on headphones and record your first take.",
      );
    } catch {
      fail(
        new Error(
          "Could not decode this file. Please choose a supported MP3 or WAV under 120 MB.",
        ),
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function record() {
    setError("");
    const from = currentPosition();
    stop();
    setPosition(from);
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Recording needs localhost or HTTPS in a recent Chrome browser.",
        );
      const ctx = audioContext();
      await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: device ? { exact: device } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      activeStream.current = stream;
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      const capture = await createPcmCapture(ctx, stream);
      recorder.current = capture;
      const estimated = estimatedDelayMs(ctx, stream);
      setDelayEstimate(estimated);
      const delayMs = mix.recordingDelayMs ?? estimated;
      captureInfo.current = { from, delayMs };
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCountdown(0);
      const when =
        Math.ceil((ctx.currentTime + 0.12) * ctx.sampleRate) / ctx.sampleRate;
      capture.start(when);
      setRecording(true);
      setMix((m) => ({ ...m, enabled: false }));
      await play(from, true, false, tracks, when);
      setBusy(false);
    } catch (e) {
      recorder.current?.dispose();
      recorder.current = null;
      activeStream.current?.getTracks().forEach((t) => t.stop());
      activeStream.current = null;
      setCountdown(0);
      setBusy(false);
      setRecording(false);
      stop();
      fail(e);
    }
  }
  async function stopRecording() {
    const capture = recorder.current;
    if (!capture) return;
    setRecording(false);
    setBusy(true);
    stop();
    const { from, delayMs } = captureInfo.current;
    setPosition(from);
    try {
      const buffer = await capture.stop();
      setTracks((ts) => [
        ...ts,
        {
          ...makeTrack(
            `Vocal take ${ts.filter((t) => t.kind === "vocal").length + 1}`,
            buffer,
            "vocal",
          ),
          offset: from - delayMs / 1000,
          capture: {
            clock: "audio-context" as const,
            sampleRate: buffer.sampleRate,
            frames: buffer.length,
            delayMs,
          },
        },
      ]);
      notify(
        "Take captured on the playback clock. If it still sounds late, nudge it earlier under Timing & cleanup.",
      );
    } catch (e) {
      fail(e);
    } finally {
      capture.dispose();
      recorder.current = null;
      activeStream.current?.getTracks().forEach((t) => t.stop());
      activeStream.current = null;
      setBusy(false);
    }
  }
  async function exportAudio() {
    setBusy(true);
    stop();
    try {
      const buffer =
        processedSelected && processed
          ? processed.buffer
          : await renderMix(tracks, { ...mix, enabled: false });
      const version = processedSelected ? "processed" : "original";
      download(
        encodeWav(buffer),
        `${name.replace(/[^a-z0-9_-]/gi, "-")}-${version}.wav`,
      );
      notify(`Your ${version} stereo WAV mix is ready.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await saveProject(
        projectId,
        name,
        tracks,
        mix,
        processedReady ? processed : null,
      );
      notify("Project saved on this device, including all audio.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openProjects() {
    try {
      setSaved(await projects());
      setModal("projects");
    } catch (e) {
      fail(e);
    }
  }
  async function reopen(p: any) {
    setBusy(true);
    try {
      const loaded = await loadProject(p);
      stop();
      setTracks(loaded.tracks);
      setProcessed(loaded.processed);
      setMix(loaded.mix);
      setPreset(loaded.mix.preset);
      setName(loaded.name);
      setProjectId(loaded.id);
      setPosition(0);
      setModal(null);
      setPage("studio");
      notify("Project reopened from this device.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <MotionConfig reducedMotion="user">
      <Atmosphere />
      <div className={`app page-${page}`}>
        <header>
          <button
            className="brand"
            aria-label="VocalRoom home"
            disabled={recording || busy}
            onClick={() => {
              stop();
              setPage("home");
            }}
          >
            <span className="brand-icon">
              <AudioLines size={23} />
            </span>
            vocalroom<span className="brand-dot">®</span>
          </button>
          <div className="header-right">
            <span className="local-label">
              <span /> A little room. Unlimited possibility.
            </span>
            <button
              className="quiet"
              disabled={recording || busy}
              onClick={openProjects}
            >
              <FolderOpen size={16} /> My projects
            </button>
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main
            key={page}
            initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {page === "home" && (
              <>
                <section className="hero">
                  <div className="hero-art">
                    <div className="orbit-label">
                      DESIGNED FOR YOUR NEXT GREAT TAKE
                    </div>
                    <Suspense
                      fallback={
                        <div className="loading-scene">Setting the stage…</div>
                      }
                    >
                      <MicScene />
                    </Suspense>
                    <div className="object-caption">
                      <span className="tiny-cross">+</span>
                      <span>
                        THE WORLD IS LISTENING.
                        <br />
                        <b>MAKE IT SOUND LIKE YOU.</b>
                      </span>
                    </div>
                  </div>
                  <div className="hero-copy">
                    <div className="eyebrow">
                      <span /> YOUR PERSONAL RECORDING STUDIO
                    </div>
                    <h1>
                      Your Voice.
                      <br />
                      <span>Your Studio.</span>
                    </h1>
                    <p>
                      Record your vocals. Shape your sound.
                      <br />
                      Create something extraordinary.
                    </p>
                    <Magnetic
                      className="primary"
                      onClick={() => setPage("style")}
                    >
                      Start Creating <ArrowUpRight size={22} />
                    </Magnetic>
                    <span className="hero-note">
                      No downloads. No limits. Just you.
                    </span>
                  </div>
                </section>
                <motion.footer
                  className="home-footer"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.65 }}
                >
                  <div>
                    <span className="status-dot" /> YOUR SOUND. YOUR SPACE.
                  </div>
                  <span>Made for the moments inspiration finds you.</span>
                  <button onClick={() => setModal("terms")}>
                    Private by design <ArrowUpRight size={13} />
                  </button>
                </motion.footer>
              </>
            )}
            {page === "style" && (
              <section className="style-screen">
                <button className="back quiet" onClick={() => setPage("home")}>
                  <ArrowLeft size={16} /> Back
                </button>
                <div className="eyebrow">01 / SET THE FEELING</div>
                <h2>
                  Find your
                  <br />
                  <span>signature sound.</span>
                </h2>
                <p className="muted">
                  A starting point for your voice. Make it yours in the studio.
                </p>
                <div className="preset-list">
                  {(["Natural", "Warm Studio", "Pop Vocal"] as Preset[]).map(
                    (p, i) => (
                      <motion.button
                        key={p}
                        className={`preset ${preset === p ? "selected" : ""}`}
                        onClick={() => setPreset(p)}
                        whileHover={{ y: -5 }}
                      >
                        <span className={`preset-art art-${i}`}>
                          <AudioLines size={70} strokeWidth={0.65} />
                        </span>
                        <span className="preset-number">0{i + 1}</span>
                        <span className="preset-title">
                          {p} {preset === p && <Check size={18} />}
                        </span>
                        <span className="muted">
                          {
                            [
                              "Honest, open, effortlessly you.",
                              "Rich presence. A little golden hour.",
                              "Bright, confident, front and center.",
                            ][i]
                          }
                        </span>
                      </motion.button>
                    ),
                  )}
                </div>
                <Magnetic
                  className="primary"
                  onClick={() => {
                    setMix((m) => ({ ...m, preset }));
                    setPage("studio");
                  }}
                >
                  Enter the Studio <ArrowRight size={19} />
                </Magnetic>
                <small>Local DSP presets. Always adjustable.</small>
              </section>
            )}
            {page === "studio" && (
              <section className="studio">
                <div className="studio-heading">
                  <div>
                    <div className="eyebrow">YOUR PRIVATE CREATIVE SPACE</div>
                    <input
                      className="project-name"
                      aria-label="Project name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="studio-actions">
                    <button
                      className="quiet"
                      disabled={busy || recording}
                      onClick={newProject}
                    >
                      <Plus size={15} /> New Project
                    </button>
                    <button
                      className="quiet"
                      onClick={() => setModal("reset")}
                      disabled={busy || recording}
                    >
                      <RotateCcw size={15} /> Reset project
                    </button>
                    <button
                      className="quiet"
                      onClick={save}
                      disabled={busy || recording || !tracks.length}
                    >
                      <Save size={16} /> Save project
                    </button>
                    <Magnetic
                      className="outlined"
                      onClick={exportAudio}
                      disabled={busy || recording || !tracks.length}
                    >
                      <Download size={16} /> Export WAV
                    </Magnetic>
                  </div>
                </div>
                <div className="studio-grid">
                  <div className="editor">
                    <div className="transport">
                      <button
                        className="transport-play"
                        aria-label={playing ? "Stop playback" : "Play mix"}
                        disabled={!tracks.length || busy || recording}
                        onClick={() => (playing ? stop() : play())}
                      >
                        {playing ? <Square size={18} /> : <Play size={18} />}
                      </button>
                      <button
                        className={`record-button ${recording ? "is-recording" : ""}`}
                        disabled={busy}
                        onClick={() => (recording ? stopRecording() : record())}
                      >
                        {recording ? <Square size={14} /> : <span />}
                        {recording ? "Stop recording" : "Record a take"}
                      </button>
                      <div className="transport-time">
                        {time(position)} <span>/ {time(total)}</span>
                      </div>
                      <span className="sample-rate">44.1 kHz · STEREO</span>
                    </div>
                    <div className="timeline">
                      <span>TRACKS</span>
                      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                        <button
                          key={f}
                          disabled={busy || recording}
                          onClick={() => seekTo(total * f)}
                          title={`Jump to ${time(total * f)}`}
                        >
                          {time(total * f)}
                        </button>
                      ))}
                    </div>
                    {!tracks.length ? (
                      <div className="empty-tracks">
                        <div className="empty-icon">
                          <Music2 size={29} strokeWidth={1} />
                        </div>
                        <h3>Every great song starts somewhere.</h3>
                        <p>
                          Record your voice on its own, or bring an
                          instrumental.
                        </p>
                        <button
                          className="empty-record quiet"
                          disabled={busy || recording}
                          onClick={record}
                        >
                          <Mic size={16} /> Record without a backing track
                        </button>
                        <label className="rights">
                          <input
                            type="checkbox"
                            checked={rights}
                            onChange={(e) => setRights(e.target.checked)}
                          />{" "}
                          I have permission to use this backing track.
                        </label>
                        <Magnetic
                          className="outlined"
                          disabled={!rights || busy}
                          onClick={() => input.current?.click()}
                        >
                          <Plus size={17} /> Import backing track
                        </Magnetic>
                        <small>
                          MP3 or WAV · Up to 120 MB · Stays on your device
                        </small>
                      </div>
                    ) : (
                      <fieldset
                        className="track-list"
                        disabled={recording || busy}
                      >
                        {tracks.map((t) => (
                          <div
                            className={`track ${t.mute ? "muted-track" : ""}`}
                            key={t.id}
                          >
                            <div className="track-top">
                              <div className={`track-name ${t.kind}`}>
                                {t.kind === "vocal" ? (
                                  <Mic size={16} />
                                ) : (
                                  <Music2 size={16} />
                                )}
                                <span>{t.name}</span>
                                {t.kind === "vocal" && (
                                  <small className="original-tag">
                                    ORIGINAL
                                  </small>
                                )}
                              </div>
                              <div className="track-switches">
                                <button
                                  aria-label={`Mute ${t.name}`}
                                  title="Mute — silence this track"
                                  data-tooltip="Mute"
                                  aria-pressed={t.mute}
                                  onClick={() =>
                                    update(t.id, { mute: !t.mute })
                                  }
                                >
                                  M
                                </button>
                                <button
                                  aria-label={`Solo ${t.name}`}
                                  title="Solo — hear only soloed tracks"
                                  data-tooltip="Solo"
                                  aria-pressed={t.solo}
                                  onClick={() =>
                                    update(t.id, { solo: !t.solo })
                                  }
                                >
                                  S
                                </button>
                                <button
                                  aria-label={`Remove ${t.name}`}
                                  onClick={() => {
                                    stop();
                                    setTracks((ts) =>
                                      ts.filter((x) => x.id !== t.id),
                                    );
                                  }}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                            <div
                              className="wave-lane"
                              onClick={(e) => {
                                const r =
                                  e.currentTarget.getBoundingClientRect();
                                seekTo(
                                  ((e.clientX - r.left) / r.width) * total,
                                );
                              }}
                              title="Click to move the playhead"
                            >
                              <Waveform track={t} total={total} />
                              <div
                                className="playhead"
                                style={{
                                  left: `${Math.min(100, (position / total) * 100)}%`,
                                }}
                              />
                            </div>
                            <div className="track-controls">
                              <label>
                                <Volume2 size={13} />
                                <input
                                  aria-label={`${t.name} volume`}
                                  type="range"
                                  min="0"
                                  max="1.5"
                                  step=".01"
                                  value={t.volume}
                                  onChange={(e) =>
                                    update(t.id, { volume: +e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                Pan
                                <input
                                  aria-label={`${t.name} pan`}
                                  type="range"
                                  min="-1"
                                  max="1"
                                  step=".01"
                                  value={t.pan}
                                  onChange={(e) =>
                                    update(t.id, { pan: +e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                Sync (ms)
                                <input
                                  type="number"
                                  step="10"
                                  value={Math.round(t.offset * 1000)}
                                  onChange={(e) =>
                                    update(t.id, {
                                      offset: +e.target.value / 1000,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Trim in (s)
                                <input
                                  type="number"
                                  min="0"
                                  max={t.trimEnd - 0.01}
                                  step=".1"
                                  value={t.trimStart}
                                  onChange={(e) =>
                                    update(t.id, {
                                      trimStart: Math.min(
                                        t.trimEnd - 0.01,
                                        Math.max(0, +e.target.value),
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Out (s)
                                <input
                                  type="number"
                                  min={t.trimStart + 0.01}
                                  max={t.buffer.duration}
                                  step=".1"
                                  value={+t.trimEnd.toFixed(2)}
                                  onChange={(e) =>
                                    update(t.id, {
                                      trimEnd: Math.max(
                                        t.trimStart + 0.01,
                                        Math.min(
                                          t.buffer.duration,
                                          +e.target.value,
                                        ),
                                      ),
                                    })
                                  }
                                />
                              </label>
                            </div>
                            {t.kind === "vocal" && (
                              <details className="track-advanced">
                                <summary>Timing &amp; cleanup</summary>
                                <div>
                                  <button
                                    title="Move this take 10 milliseconds earlier"
                                    onClick={() =>
                                      update(t.id, { offset: t.offset - 0.01 })
                                    }
                                  >
                                    Earlier · 10 ms
                                  </button>
                                  <button
                                    title="Move this take 10 milliseconds later"
                                    onClick={() =>
                                      update(t.id, { offset: t.offset + 0.01 })
                                    }
                                  >
                                    Later · 10 ms
                                  </button>
                                  <label>
                                    Noise-only intro (s)
                                    <input
                                      type="number"
                                      aria-label={`Noise-only intro for ${t.name}`}
                                      min="0"
                                      max={Math.min(10, t.buffer.duration)}
                                      step=".1"
                                      value={t.noiseProfileSeconds ?? 0}
                                      onChange={(e) =>
                                        update(t.id, {
                                          noiseProfileSeconds: Math.max(
                                            0,
                                            Math.min(
                                              t.buffer.duration,
                                              +e.target.value,
                                            ),
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                                <p>
                                  0 = automatic noise estimate. For better
                                  cleanup, enter how long only room noise is
                                  heard at the start of this recording; do not
                                  include singing. Process again after changing
                                  it.
                                </p>
                                {t.capture && (
                                  <p>
                                    PCM capture · {t.capture.sampleRate} Hz ·{" "}
                                    {t.capture.delayMs} ms device-delay
                                    correction · no codec timing conversion
                                  </p>
                                )}
                              </details>
                            )}
                          </div>
                        ))}
                      </fieldset>
                    )}
                    {tracks.length > 0 && (
                      <div className="add-track">
                        <label className="rights">
                          <input
                            type="checkbox"
                            checked={rights}
                            onChange={(e) => setRights(e.target.checked)}
                          />{" "}
                          I have permission to use imported audio.
                        </label>
                        <button
                          className="quiet"
                          disabled={!rights || busy || recording}
                          onClick={() => input.current?.click()}
                        >
                          <Plus size={15} /> Add backing track
                        </button>
                      </div>
                    )}
                    <input
                      ref={input}
                      hidden
                      type="file"
                      accept=".mp3,.wav,audio/mpeg,audio/wav"
                      onChange={(e) => importFile(e.target.files?.[0])}
                    />
                    <div className="seek-row">
                      <label htmlFor="seek">Position</label>
                      <input
                        id="seek"
                        type="range"
                        min="0"
                        max={Math.max(total, position)}
                        step=".01"
                        disabled={recording || busy}
                        value={position}
                        onChange={(e) => seekTo(+e.target.value)}
                      />
                    </div>
                    <div className="record-position">
                      <label>
                        Record from (seconds)
                        <input
                          aria-label="Record from (seconds)"
                          type="number"
                          min="0"
                          step=".1"
                          value={+position.toFixed(2)}
                          disabled={busy || recording}
                          onChange={(e) => seekTo(+e.target.value)}
                        />
                      </label>
                      <span>
                        {recording
                          ? "Recording at the playhead…"
                          : "Choose any point. New takes start here, with or without a backing track."}
                      </span>
                    </div>
                    {!!tracks.length && (
                      <section
                        className="comparison"
                        aria-label="Compare original and processed audio"
                      >
                        <div className="comparison-heading">
                          <span>HEAR THE DIFFERENCE</span>
                          <small>
                            Source tracks stay original. Switch at the same
                            position.
                          </small>
                        </div>
                        {processedReady && processed?.report && (
                          <label className="level-match">
                            <input
                              type="checkbox"
                              checked={mix.levelMatch ?? true}
                              disabled={busy || recording}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                setMix((m) => ({ ...m, levelMatch: enabled }));
                                if (playingRef.current)
                                  void play(
                                    currentPosition(),
                                    false,
                                    processedSelected,
                                    tracks,
                                    undefined,
                                    enabled,
                                  );
                              }}
                            />{" "}
                            Match listening levels{" "}
                            <small>
                              Comparison only; exports stay unchanged.
                            </small>
                          </label>
                        )}
                        <div className="comparison-options">
                          <button
                            disabled={busy || recording}
                            className={!processedSelected ? "selected" : ""}
                            aria-pressed={!processedSelected}
                            onClick={() => compare(false, true)}
                          >
                            <Play size={15} />
                            <span>
                              Listen to original
                              <small>
                                Your untouched recordings + backing tracks
                              </small>
                            </span>
                          </button>
                          <button
                            disabled={busy || recording || !processedReady}
                            className={processedSelected ? "selected" : ""}
                            aria-pressed={processedSelected}
                            onClick={() => compare(true, true)}
                          >
                            <Play size={15} />
                            <span>
                              Listen to processed
                              <small>
                                {processedReady
                                  ? "Cleaned vocals + balanced full mix"
                                  : processed
                                    ? "Session changed. Process again to update."
                                    : "Process your session to unlock the full mix"}
                              </small>
                            </span>
                          </button>
                        </div>
                      </section>
                    )}
                    <div className="record-hint">
                      <Headphones size={16} />
                      <span>
                        Headphones on. Your microphone is recorded separately,
                        without live monitoring.
                      </span>
                    </div>
                    <div className="capture-settings">
                      <label>
                        Recording delay correction (ms)
                        <input
                          aria-label="Recording delay correction (ms)"
                          type="number"
                          min="0"
                          max="1000"
                          step="5"
                          placeholder={
                            delayEstimate === null
                              ? "Auto"
                              : String(delayEstimate)
                          }
                          value={mix.recordingDelayMs ?? ""}
                          disabled={busy || recording}
                          onChange={(e) =>
                            setMix((m) => ({
                              ...m,
                              recordingDelayMs:
                                e.target.value === ""
                                  ? undefined
                                  : Math.max(
                                      0,
                                      Math.min(1000, +e.target.value),
                                    ),
                            }))
                          }
                        />
                      </label>
                      <small>
                        {delayEstimate === null
                          ? "Auto estimates device delay when recording starts."
                          : `Device estimate: ${delayEstimate} ms.`}{" "}
                        Hardware delay varies. Leave blank for Auto; increase if
                        new vocals arrive late. Wired headphones give more
                        consistent timing.
                      </small>
                    </div>
                    <label className="device-label">
                      Microphone
                      <select
                        disabled={busy || recording}
                        value={device}
                        onChange={(e) => setDevice(e.target.value)}
                      >
                        <option value="">System default</option>
                        {devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || "Microphone"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <aside className="mix-panel">
                    <div className="eyebrow">
                      <Sparkles size={14} /> THE FINISHING TOUCH
                    </div>
                    <h3>
                      A little polish.
                      <br />
                      <span>A lot of you.</span>
                    </h3>
                    <p>
                      Clean your vocals, then bring every track together in one
                      finished mix.
                    </p>
                    <Magnetic
                      className="primary polish-button"
                      disabled={busy || recording || !tracks.length}
                      onClick={processAudio}
                    >
                      <Sparkles size={16} /> Make My Voice Sound Professional
                    </Magnetic>
                    {processing && (
                      <div
                        className="processing-progress"
                        role="status"
                        aria-live="polite"
                      >
                        <div>
                          <span>Processing your session</span>
                          <b>{Math.round(processing.progress * 100)}%</b>
                        </div>
                        <progress
                          aria-label="Audio processing progress"
                          max="1"
                          value={processing.progress}
                        />
                        <p>{processing.detail}</p>
                        <ol>
                          {stageOrder.map((stage, i) => (
                            <li
                              key={stage}
                              className={
                                [...stageOrder, "ready"].indexOf(
                                  processing.stage,
                                ) >= i
                                  ? "reached"
                                  : ""
                              }
                            >
                              {stageLabels[stage]}
                            </li>
                          ))}
                        </ol>
                        <button
                          className="quiet"
                          onClick={() => processingAbort.current?.abort()}
                        >
                          Cancel processing
                        </button>
                      </div>
                    )}
                    <label className="effect-label">
                      Vocal character
                      <select
                        value={mix.preset}
                        disabled={recording || busy}
                        onChange={(e) => {
                          changeMix({
                            preset: e.target.value as Preset,
                          });
                        }}
                      >
                        {["Natural", "Warm Studio", "Pop Vocal"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                    <label className="effect-label">
                      Intensity <span>{Math.round(mix.intensity * 100)}%</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={mix.intensity}
                        disabled={recording || busy}
                        onChange={(e) => {
                          changeMix({ intensity: +e.target.value });
                        }}
                      />
                    </label>
                    <label className="effect-label">
                      Background noise reduction{" "}
                      <span>
                        {Math.round((mix.noiseReduction ?? 0.65) * 100)}%
                      </span>
                      <input
                        aria-label="Background noise reduction"
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={mix.noiseReduction ?? 0.65}
                        disabled={busy || recording}
                        onChange={(e) =>
                          changeMix({ noiseReduction: +e.target.value })
                        }
                      />
                    </label>
                    <small className="noise-note">
                      Reduces steady noise and rumble. Overlapping voices may
                      remain; lower the amount if singing sounds affected.
                    </small>
                    <details className="studio-advanced">
                      <summary>Advanced controls</summary>
                      <label className="effect-label">
                        Processing engine
                        <select
                          aria-label="Processing engine"
                          value={mix.engine ?? "legacy"}
                          disabled={busy || recording}
                          onChange={(e) =>
                            changeMix({
                              engine: e.target.value as "studio" | "legacy",
                            })
                          }
                        >
                          <option value="studio">Studio Polish</option>
                          <option value="legacy">Classic DSP (fallback)</option>
                        </select>
                      </label>
                      <label className="auto-mix-toggle">
                        <input
                          type="checkbox"
                          checked={mix.stereoDelay ?? false}
                          disabled={
                            busy || recording || mix.engine !== "studio"
                          }
                          onChange={(e) =>
                            changeMix({ stereoDelay: e.target.checked })
                          }
                        />{" "}
                        Short stereo delay
                      </label>
                      <small>
                        Studio Polish adapts to your voice and backing track.
                        Classic DSP keeps the previous processing chain
                        available.
                      </small>
                    </details>
                    <label className="auto-mix-toggle">
                      <input
                        type="checkbox"
                        checked={mix.autoMix ?? true}
                        disabled={busy || recording}
                        onChange={(e) =>
                          changeMix({ autoMix: e.target.checked })
                        }
                      />{" "}
                      Balance the full mix
                    </label>
                    <div className="ab-switch">
                      <button
                        disabled={recording || busy}
                        className={!processedSelected ? "active" : ""}
                        onClick={() => compare(false)}
                      >
                        Original
                      </button>
                      <button
                        disabled={recording || busy || !processedReady}
                        className={processedSelected ? "active" : ""}
                        onClick={() => compare(true)}
                      >
                        Processed
                      </button>
                    </div>
                    <small className="mix-version" role="status">
                      {processedSelected
                        ? "Listening / exporting: processed mix"
                        : processedReady
                          ? "Listening / exporting: original mix"
                          : "Original mix · Processing needed for a finished mix"}
                    </small>
                    <div className="chain">
                      HIGH-PASS <span>→</span> EQ <span>→</span> COMPRESSION
                      <br />
                      NOISE REDUCTION <span>→</span> VOCAL EFFECTS
                      <br />
                      FULL-MIX BALANCE <span>→</span> BUS COMPRESSION{" "}
                      <span>→</span> PEAK CONTROL
                    </div>
                    <div className="privacy-note">
                      <ShieldCheck size={18} />
                      <p>
                        Your session stays here.
                        <br />
                        <span>Processed locally. Never uploaded.</span>
                      </p>
                    </div>
                    <small>
                      Real audio DSP. No cloud AI or simulated processing.
                    </small>
                  </aside>
                </div>
              </section>
            )}
          </motion.main>
        </AnimatePresence>
        {(message || error) && (
          <div
            className={`toast ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || message}
            <button
              aria-label="Dismiss message"
              onClick={() => {
                setMessage("");
                setError("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {countdown > 0 && (
          <div className="countdown" role="status">
            <span>FIND YOUR MOMENT</span>
            <strong>{countdown}</strong>
            <p>Recording starts after the countdown. Headphones on.</p>
          </div>
        )}
        {modal && (
          <div className="modal-backdrop" onClick={() => setModal(null)}>
            <section
              role="dialog"
              aria-modal="true"
              aria-label={
                modal === "terms"
                  ? "Privacy and copyright"
                  : modal === "reset" || modal === "new"
                    ? modal === "new"
                      ? "New Project"
                      : "Reset project"
                    : "Saved projects"
              }
              className="modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                autoFocus
                className="modal-close quiet"
                onClick={() => setModal(null)}
              >
                <X /> Close
              </button>
              {modal === "projects" ? (
                <>
                  <div className="eyebrow">RIGHT WHERE YOU LEFT OFF</div>
                  <div className="project-library-heading">
                    <h2>My projects.</h2>
                    <Magnetic
                      className="outlined"
                      disabled={busy || recording}
                      onClick={newProject}
                    >
                      <Plus size={16} /> New Project
                    </Magnetic>
                  </div>
                  {saved.length ? (
                    saved.map((p) => (
                      <button
                        className="saved-project"
                        key={p.id}
                        disabled={busy}
                        onClick={() => reopen(p)}
                      >
                        <span>
                          {p.name}
                          <small>
                            {new Date(p.updated).toLocaleString("en-US")} ·{" "}
                            {p.tracks.length} tracks
                          </small>
                        </span>
                        <ArrowUpRight />
                      </button>
                    ))
                  ) : (
                    <p>
                      No saved sessions yet. Create something worth coming back
                      to.
                    </p>
                  )}
                  <small>
                    Projects are stored in this browser. Clearing site data
                    removes them.
                  </small>
                </>
              ) : modal === "reset" || modal === "new" ? (
                <>
                  <div className="eyebrow">A FRESH START</div>
                  <h2>
                    {modal === "new"
                      ? "Start a new project?"
                      : "Reset this session?"}
                  </h2>
                  <p>
                    Your current session will be replaced. Save it first to keep
                    your recordings and processed mix. Saved projects stay in My
                    projects.
                  </p>
                  <div className="reset-actions">
                    <button
                      className="outlined magnetic"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await saveProject(
                            projectId,
                            name,
                            tracks,
                            mix,
                            processedReady ? processed : null,
                          );
                          resetProject();
                        } catch (e) {
                          fail(e);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Save & start new
                    </button>
                    <Magnetic className="primary" onClick={resetProject}>
                      {modal === "new"
                        ? "Start without saving"
                        : "Reset project"}
                    </Magnetic>
                    <button className="quiet" onClick={() => setModal(null)}>
                      Keep creating
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="eyebrow">YOUR SOUND BELONGS TO YOU</div>
                  <h2>Private by design.</h2>
                  <p>
                    Audio is recorded, processed, and saved on your device.
                    VocalRoom does not upload your tracks. No account or API key
                    is required.
                  </p>
                  <h3>Copyright & permissions</h3>
                  <p>
                    Only import music you own or have permission to use. You are
                    responsible for the rights needed to record, export, and
                    distribute your work. Confirming permissions does not remove
                    anyone’s legal obligations.
                  </p>
                  <h3>Keep a copy</h3>
                  <p>
                    Browser storage can be cleared or run out. Export important
                    mixes and keep original audio files. This software is
                    provided as is, without guarantees of storage or fitness for
                    a particular use.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

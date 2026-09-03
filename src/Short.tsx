import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  delayRender,
  continueRender,
} from "remotion";

type Word = { text: string; start: number; end: number };
type Scene = { video: string; start: number; end: number };
type Props = {
  scenes: Scene[];
  words: Word[];
  audio: string;
  music: string;
  font?: string;
  fontCss?: string;
  rtl?: boolean;
  watermark?: string;
  watermarkImage?: string;
  captionPos?: "top" | "middle" | "bottom";
  motion?: "in" | "out" | "subtle" | "none" | "random";
  talkingVideo?: string;
  effect?: string;
};

const MOTION_RANGE: Record<string, [number, number]> = {
  in: [1.06, 1.2], out: [1.2, 1.06], subtle: [1.03, 1.1], none: [1, 1],
};
// cinematic colour/camera looks applied to every scene's footage
const EFFECT_FILTER: Record<string, string> = {
  none: "",
  tiltshift: "saturate(1.5) contrast(1.12)",       // miniature look (+ blur band below)
  vintage: "sepia(0.42) contrast(1.15) brightness(1.04) saturate(1.15)",
  noir: "grayscale(1) contrast(1.32) brightness(1.03)",
  dreamy: "brightness(1.08) contrast(0.96) saturate(1.12)",
  vibrant: "saturate(1.55) contrast(1.12)",
  cold: "saturate(1.12) brightness(1.02) hue-rotate(-8deg)",
  warm: "sepia(0.22) saturate(1.22) brightness(1.03)",
  vhs: "saturate(1.35) contrast(1.08) brightness(1.02)",
  lightleak: "brightness(1.04) saturate(1.18)",
  letterbox: "contrast(1.06) saturate(1.06)",
};
const VIGNETTE_EFFECTS = new Set(["tiltshift", "vintage", "noir", "dreamy"]);
// top/bottom visible, middle transparent → reveals a blurred copy only at the edges
const TILT_MASK = "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.55) 16%, transparent 34%, transparent 66%, rgba(0,0,0,0.55) 84%, #000 100%)";

const SceneClip: React.FC<{ src: string; durationInFrames: number; motion: string; effect: string }> = ({ src, durationInFrames, motion, effect }) => {
  const frame = useCurrentFrame();
  const [from, to] = MOTION_RANGE[motion] || MOTION_RANGE.in;
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateRight: "clamp",
  });
  const isImage = /\.(jpe?g|png|webp)$/i.test(src);
  const filter = EFFECT_FILTER[effect] || "";
  const media = { width: "100%", height: "100%", objectFit: "cover" as const, transform: `scale(${scale})`, filter };
  const Media: React.FC<{ extra?: React.CSSProperties }> = ({ extra }) =>
    isImage ? <Img src={src} style={{ ...media, ...extra }} /> : <OffthreadVideo src={src} muted style={{ ...media, ...extra }} />;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <Media />
      {effect === "tiltshift" ? (
        <Media extra={{ position: "absolute", inset: 0, filter: `${filter} blur(7px)`, WebkitMaskImage: TILT_MASK, maskImage: TILT_MASK }} />
      ) : null}
    </AbsoluteFill>
  );
};

const GROUP = 3;

const Captions: React.FC<{ words: Word[]; font: string; rtl: boolean; captionPos: string }> = ({ words, font, rtl, captionPos }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;

  // scale caption styling to the output dimensions so it reads in any aspect ratio
  const base = Math.min(width, height);
  const fontSize = Math.round(base * 0.085);
  const stroke = Math.max(3, Math.round(base * 0.0075));
  const gap = Math.round(base * 0.02);
  const padX = Math.round(width * 0.07);
  const shiftY = captionPos === "top" ? Math.round(-height * 0.30) : captionPos === "bottom" ? Math.round(height * 0.22) : 0;

  // index of the most recently started word
  let cur = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t) cur = i;
    else break;
  }
  if (cur === -1) return null;

  const groupStart = Math.floor(cur / GROUP) * GROUP;
  const chunk = words.slice(groupStart, groupStart + GROUP);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${padX}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          direction: rtl ? "rtl" : "ltr",
          gap: `0 ${gap}px`,
          transform: `translateY(${shiftY}px)`,
        }}
      >
        {chunk.map((w, i) => {
          const globalIdx = groupStart + i;
          const spoken = t >= w.start && t < w.end;
          const pop = spoken
            ? interpolate(t, [w.start, w.start + 0.12], [0.8, 1], { extrapolateRight: "clamp" })
            : 1;
          return (
            <span
              key={globalIdx}
              style={{
                fontFamily: `'${font}', 'Arial Black', Impact, sans-serif`,
                fontWeight: 900,
                fontSize,
                lineHeight: 1.05,
                textTransform: "uppercase",
                color: spoken ? "#FFDD00" : "#FFFFFF",
                WebkitTextStroke: `${stroke}px #000000`,
                paintOrder: "stroke fill",
                textShadow: "0 6px 18px rgba(0,0,0,0.7)",
                transform: `scale(${pop})`,
                display: "inline-block",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Short: React.FC<Props> = ({ scenes, words, audio, music, font = "Arial Black", fontCss = "", rtl = false, watermark = "", watermarkImage = "", captionPos = "bottom", motion = "in", talkingVideo = "", effect = "none" }) => {
  const { fps, width, height } = useVideoConfig();
  const mOpts = ["in", "out", "subtle"];
  const sceneMotion = (i: number) => (motion === "random" ? mOpts[i % mOpts.length] : motion);
  const [handle] = useState(() => (fontCss ? delayRender("loading-font") : null));

  useEffect(() => {
    if (!fontCss || handle === null) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontCss;
    document.head.appendChild(link);
    const done = () => continueRender(handle);
    // wait for the webfont to actually load, then release the render
    (document as any).fonts
      ? (document as any).fonts.load(`700 100px "${font}"`).then(done).catch(done)
      : setTimeout(done, 1500);
    const safety = setTimeout(done, 8000); // never hang the render
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {talkingVideo ? (
        <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
          <OffthreadVideo src={staticFile(talkingVideo)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      ) : (
        scenes.map((s, i) => {
          const from = Math.floor(s.start * fps);
          const durationInFrames = Math.max(1, Math.ceil((s.end - s.start) * fps));
          return (
            <Sequence key={i} from={from} durationInFrames={durationInFrames}>
              <SceneClip src={staticFile(s.video)} durationInFrames={durationInFrames} motion={sceneMotion(i)} effect={effect} />
            </Sequence>
          );
        })
      )}

      {/* cinematic effect overlays (vignette + film grain) */}
      {VIGNETTE_EFFECTS.has(effect) ? (
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.55) 100%)" }} />
      ) : null}
      {effect === "vintage" ? (
        <AbsoluteFill
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundRepeat: "repeat",
            opacity: 0.09,
            mixBlendMode: "overlay",
          }}
        />
      ) : null}
      {effect === "vhs" ? (
        <>
          <AbsoluteFill style={{ background: "repeating-linear-gradient(to bottom, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 2px, transparent 4px)", pointerEvents: "none" }} />
          <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(255,0,80,0.05), transparent 6%, transparent 94%, rgba(0,200,255,0.05))", mixBlendMode: "screen" }} />
        </>
      ) : null}
      {effect === "lightleak" ? (
        <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 92% 8%, rgba(255,150,40,0.45), rgba(255,80,60,0.12) 32%, transparent 60%)", mixBlendMode: "screen" }} />
      ) : null}
      {effect === "letterbox" ? (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "11%", background: "#000" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "11%", background: "#000" }} />
        </>
      ) : null}

      {/* dark gradient for caption legibility */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0.10) 35%, rgba(0,0,0,0.10) 60%, rgba(0,0,0,0.75) 100%)",
        }}
      />

      <Captions words={words} font={font} rtl={rtl} captionPos={captionPos} />

      {watermarkImage ? (
        <Img
          src={staticFile(watermarkImage)}
          style={{
            position: "absolute",
            bottom: Math.round(height * 0.03),
            left: "50%",
            transform: "translateX(-50%)",
            width: Math.round(Math.min(width, height) * 0.22),
            height: "auto",
            opacity: 0.9,
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
          }}
        />
      ) : watermark ? (
        <div
          style={{
            position: "absolute",
            bottom: Math.round(height * 0.035),
            width: "100%",
            textAlign: "center",
            color: "rgba(255,255,255,0.72)",
            fontFamily: "'Arial Black', Impact, sans-serif",
            fontWeight: 800,
            fontSize: Math.round(Math.min(width, height) * 0.032),
            letterSpacing: 1,
            textShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}
        >
          {watermark}
        </div>
      ) : null}

      {/* talking clip carries the voice itself — skip the separate track to avoid an echo */}
      {audio && !talkingVideo ? <Audio src={staticFile(audio)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={0.22} loop /> : null}
    </AbsoluteFill>
  );
};

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
};

const MOTION_RANGE: Record<string, [number, number]> = {
  in: [1.06, 1.2], out: [1.2, 1.06], subtle: [1.03, 1.1], none: [1, 1],
};
const SceneClip: React.FC<{ src: string; durationInFrames: number; motion: string }> = ({ src, durationInFrames, motion }) => {
  const frame = useCurrentFrame();
  const [from, to] = MOTION_RANGE[motion] || MOTION_RANGE.in;
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateRight: "clamp",
  });
  const isImage = /\.(jpe?g|png|webp)$/i.test(src);
  const media = { width: "100%", height: "100%", objectFit: "cover" as const, transform: `scale(${scale})` };
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      {isImage ? <Img src={src} style={media} /> : <OffthreadVideo src={src} muted style={media} />}
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

export const Short: React.FC<Props> = ({ scenes, words, audio, music, font = "Arial Black", fontCss = "", rtl = false, watermark = "", watermarkImage = "", captionPos = "bottom", motion = "in" }) => {
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
      {scenes.map((s, i) => {
        const from = Math.floor(s.start * fps);
        const durationInFrames = Math.max(1, Math.ceil((s.end - s.start) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <SceneClip src={staticFile(s.video)} durationInFrames={durationInFrames} motion={sceneMotion(i)} />
          </Sequence>
        );
      })}

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

      {audio ? <Audio src={staticFile(audio)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={0.18} /> : null}
    </AbsoluteFill>
  );
};

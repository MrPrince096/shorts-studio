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
} from "remotion";

// Split-screen "Comparison" template: two panels side-by-side (e.g. Textbook vs
// Casual), the same subject on each side, with stacked trilingual captions
// (native script + romaji reading + English translation). Each panel's visual
// can be a still image (Ken-Burns zoom) or a short AI video clip.
type CompScene = {
  leftMedia: string;   // file in public/ (jpg/png or mp4)
  rightMedia: string;
  native: string;      // e.g. Japanese
  romaji: string;      // reading, shown under the native line
  english: string;     // translation
  start: number;       // seconds
  end: number;
};
type Props = {
  scenes: CompScene[];
  audio: string;
  music: string;
  leftLabel: string;
  rightLabel: string;
  leftEmoji: string;
  rightEmoji: string;
  watermark?: string;
  captionFont?: string;
};

// One panel's visual — cover-fit with a gentle zoom so stills feel alive.
const Panel: React.FC<{ src: string; durationInFrames: number; side: "left" | "right" }> = ({ src, durationInFrames, side }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [1.04, 1.14], { extrapolateRight: "clamp" });
  const isImage = /\.(jpe?g|png|webp)$/i.test(src);
  const style = { width: "100%", height: "100%", objectFit: "cover" as const, transform: `scale(${scale})` };
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: side === "left" ? 0 : "50%", width: "50%", overflow: "hidden", backgroundColor: "#000" }}>
      {isImage ? <Img src={src} style={style} /> : <OffthreadVideo src={src} muted style={style} />}
    </div>
  );
};

const Header: React.FC<{ emoji: string; label: string; side: "left" | "right"; base: number; width: number }> = ({ emoji, label, side, base, width }) => {
  const fontSize = Math.round(base * 0.058);
  return (
    <div style={{ position: "absolute", top: Math.round(base * 0.11), left: side === "left" ? 0 : "50%", width: "50%", textAlign: "center", padding: `0 ${Math.round(width * 0.02)}px` }}>
      <div style={{ fontSize: Math.round(fontSize * 1.15), lineHeight: 1, marginBottom: 6 }}>{emoji}</div>
      <div style={{
        fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize, lineHeight: 1.02,
        color: "#fff", WebkitTextStroke: `${Math.max(2, Math.round(base * 0.006))}px #000`, paintOrder: "stroke fill",
        textShadow: "0 3px 12px rgba(0,0,0,0.8)",
      }}>{label}</div>
    </div>
  );
};

export const Comparison: React.FC<Props> = ({ scenes, audio, music, leftLabel, rightLabel, leftEmoji, rightEmoji, watermark = "", captionFont = "" }) => {
  const { fps, width, height } = useVideoConfig();
  const base = Math.min(width, height);
  const t = useCurrentFrame() / fps;
  const cur = scenes.find((s) => t >= s.start && t < s.end) || scenes[scenes.length - 1];

  const cjk = "'Hiragino Sans', 'Noto Sans JP', 'Noto Sans SC', 'Apple SD Gothic Neo', 'Arial Unicode MS', sans-serif";
  const nativeFont = captionFont ? `'${captionFont}', ${cjk}` : cjk;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* per-scene visuals for each panel */}
      {scenes.map((s, i) => {
        const from = Math.floor(s.start * fps);
        const durationInFrames = Math.max(1, Math.ceil((s.end - s.start) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <Panel src={staticFile(s.leftMedia)} durationInFrames={durationInFrames} side="left" />
            <Panel src={staticFile(s.rightMedia)} durationInFrames={durationInFrames} side="right" />
          </Sequence>
        );
      })}

      {/* center divider */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 3, marginLeft: -1.5, background: "rgba(255,255,255,0.85)", boxShadow: "0 0 12px rgba(0,0,0,0.6)" }} />

      {/* legibility gradient (top + bottom) */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 22%, rgba(0,0,0,0.05) 52%, rgba(0,0,0,0.72) 100%)", pointerEvents: "none" }} />

      {/* persistent panel headers */}
      <Header emoji={leftEmoji} label={leftLabel} side="left" base={base} width={width} />
      <Header emoji={rightEmoji} label={rightLabel} side="right" base={base} width={width} />

      {/* trilingual captions for the current scene */}
      {cur ? (
        <>
          {/* native + romaji, sitting just above the lower third */}
          <div style={{ position: "absolute", left: 0, right: 0, top: Math.round(height * 0.60), textAlign: "center", padding: `0 ${Math.round(width * 0.05)}px` }}>
            <div style={{ fontFamily: nativeFont, fontWeight: 800, fontSize: Math.round(base * 0.058), color: "#fff", WebkitTextStroke: `${Math.max(2, Math.round(base * 0.005))}px #000`, paintOrder: "stroke fill", textShadow: "0 3px 12px rgba(0,0,0,0.85)", lineHeight: 1.2 }}>
              {cur.native}
            </div>
            {cur.romaji ? (
              <div style={{ fontFamily: "'Arial', sans-serif", fontWeight: 700, fontSize: Math.round(base * 0.04), color: "#fff", WebkitTextStroke: `${Math.max(1, Math.round(base * 0.003))}px #000`, paintOrder: "stroke fill", textShadow: "0 2px 10px rgba(0,0,0,0.85)", marginTop: 4 }}>
                ({cur.romaji})
              </div>
            ) : null}
          </div>
          {/* english translation, big near the bottom */}
          <div style={{ position: "absolute", left: 0, right: 0, top: Math.round(height * 0.80), textAlign: "center", padding: `0 ${Math.round(width * 0.05)}px` }}>
            <div style={{ fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: Math.round(base * 0.075), color: "#fff", WebkitTextStroke: `${Math.max(3, Math.round(base * 0.0075))}px #000`, paintOrder: "stroke fill", textShadow: "0 5px 16px rgba(0,0,0,0.8)", lineHeight: 1.05 }}>
              {cur.english}
            </div>
          </div>
        </>
      ) : null}

      {watermark ? (
        <div style={{ position: "absolute", bottom: Math.round(height * 0.03), width: "100%", textAlign: "center", color: "rgba(255,255,255,0.7)", fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 800, fontSize: Math.round(base * 0.03), letterSpacing: 1, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
          {watermark}
        </div>
      ) : null}

      {audio ? <Audio src={staticFile(audio)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={0.18} loop /> : null}
    </AbsoluteFill>
  );
};

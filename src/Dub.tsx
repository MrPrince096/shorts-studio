import { AbsoluteFill, Audio, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

// Dub composition: play an uploaded video (muted), lay the dubbed audio track
// over it, and burn translated subtitles from the transcript segments.
type Seg = { start: number; end: number; text: string; orig?: string };
type Props = {
  videoFile: string;
  audio: string;
  segments: Seg[];
  subtitleMode?: "target" | "bilingual" | "off";
  fit?: "cover" | "contain";
};

export const Dub: React.FC<Props> = ({ videoFile, audio, segments, subtitleMode = "target", fit = "contain" }) => {
  const { fps, width, height } = useVideoConfig();
  const base = Math.min(width, height);
  const t = useCurrentFrame() / fps;
  const seg = subtitleMode === "off" ? null : segments.find((s) => t >= s.start && t < s.end);
  const cjk = "'Hiragino Sans','Noto Sans JP','Noto Sans SC','Apple SD Gothic Neo','Arial Unicode MS'";
  const fade = seg ? interpolate(t, [seg.start, seg.start + 0.15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        <OffthreadVideo src={staticFile(videoFile)} muted style={{ width: "100%", height: "100%", objectFit: fit }} />
      </AbsoluteFill>

      {/* legibility gradient at the bottom */}
      {seg ? <AbsoluteFill style={{ background: "linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.72) 100%)", pointerEvents: "none" }} /> : null}

      {seg ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: Math.round(height * 0.07), textAlign: "center", padding: `0 ${Math.round(width * 0.06)}px`, opacity: fade }}>
          <div style={{
            fontFamily: `'Arial Black', Impact, ${cjk}, sans-serif`, fontWeight: 900,
            fontSize: Math.round(base * 0.058), lineHeight: 1.18, color: "#fff",
            WebkitTextStroke: `${Math.max(2, Math.round(base * 0.006))}px #000`, paintOrder: "stroke fill",
            textShadow: "0 4px 14px rgba(0,0,0,0.85)",
          }}>
            {seg.text}
          </div>
          {subtitleMode === "bilingual" && seg.orig ? (
            <div style={{ fontFamily: `${cjk}, sans-serif`, fontWeight: 600, fontSize: Math.round(base * 0.038), color: "#dfe6f0", marginTop: 6, opacity: 0.92, WebkitTextStroke: `${Math.max(1, Math.round(base * 0.003))}px #000`, paintOrder: "stroke fill", textShadow: "0 2px 10px rgba(0,0,0,0.85)" }}>
              {seg.orig}
            </div>
          ) : null}
        </div>
      ) : null}

      {audio ? <Audio src={staticFile(audio)} /> : null}
    </AbsoluteFill>
  );
};

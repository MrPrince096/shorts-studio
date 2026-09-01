import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

type Word = { text: string; start: number; end: number };
type Scene = { video: string; start: number; end: number };
type Props = {
  scenes: Scene[];
  words: Word[];
  audio: string;
  music: string;
};

const SceneClip: React.FC<{ src: string; durationInFrames: number }> = ({ src, durationInFrames }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.2], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <OffthreadVideo
        src={src}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

const GROUP = 3;

const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;

  // scale caption styling to the output dimensions so it reads in any aspect ratio
  const base = Math.min(width, height);
  const fontSize = Math.round(base * 0.085);
  const stroke = Math.max(3, Math.round(base * 0.0075));
  const gap = Math.round(base * 0.02);
  const padX = Math.round(width * 0.07);
  const shiftY = Math.round(height * 0.06); // nudge below middle

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
                fontFamily: "'Arial Black', Impact, sans-serif",
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

export const Short: React.FC<Props> = ({ scenes, words, audio, music }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scenes.map((s, i) => {
        const from = Math.floor(s.start * fps);
        const durationInFrames = Math.max(1, Math.ceil((s.end - s.start) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <SceneClip src={staticFile(s.video)} durationInFrames={durationInFrames} />
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

      <Captions words={words} />

      {audio ? <Audio src={staticFile(audio)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={0.18} /> : null}
    </AbsoluteFill>
  );
};

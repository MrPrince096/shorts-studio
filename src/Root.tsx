import { Composition } from "remotion";
import { Short } from "./Short";
import { Comparison } from "./Comparison";
import { Dub } from "./Dub";

const dubFallback = {
  fps: 30, width: 720, height: 1280, durationInSeconds: 10,
  videoFile: "", audio: "", segments: [], subtitleMode: "target", fit: "contain",
};

const compFallback = {
  fps: 30, width: 720, height: 1280, durationInSeconds: 12,
  scenes: [], audio: "", music: "",
  leftLabel: "Textbook", rightLabel: "Casual", leftEmoji: "📕", rightEmoji: "📚",
  watermark: "", captionFont: "",
};

const fallback = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInSeconds: 10,
  audio: "",
  music: "",
  title: "",
  font: "Arial Black",
  fontCss: "",
  rtl: false,
  watermark: "",
  watermarkImage: "",
  captionPos: "bottom",
  motion: "in",
  talkingVideo: "",
  effect: "none",
  lyricLines: [],
  scenes: [],
  words: [],
};

const calcMeta = ({ props }: any) => {
  const fps = props.fps || 30;
  return {
    durationInFrames: Math.max(1, Math.ceil((props.durationInSeconds || 10) * fps)),
    fps,
    width: props.width || 1080,
    height: props.height || 1920,
  };
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Short"
        component={Short}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={fallback}
        calculateMetadata={calcMeta}
      />
      <Composition
        id="Comparison"
        component={Comparison as any}
        durationInFrames={360}
        fps={30}
        width={720}
        height={1280}
        defaultProps={compFallback}
        calculateMetadata={calcMeta}
      />
      <Composition
        id="Dub"
        component={Dub as any}
        durationInFrames={300}
        fps={30}
        width={720}
        height={1280}
        defaultProps={dubFallback}
        calculateMetadata={calcMeta}
      />
    </>
  );
};

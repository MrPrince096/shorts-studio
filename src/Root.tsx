import { Composition } from "remotion";
import { Short } from "./Short";

const fallback = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInSeconds: 10,
  audio: "",
  music: "",
  title: "",
  scenes: [],
  words: [],
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="Short"
      component={Short}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={fallback}
      calculateMetadata={({ props }) => {
        const fps = props.fps || 30;
        return {
          durationInFrames: Math.max(1, Math.ceil((props.durationInSeconds || 10) * fps)),
          fps,
          width: props.width || 1080,
          height: props.height || 1920,
        };
      }}
    />
  );
};

import React from "react";
import {
  Composition,
  Sequence,
  AbsoluteFill,
  useVideoConfig,
} from "remotion";
import { FPS, WIDTH, HEIGHT, SCENES } from "./constants";
import { Intro } from "./scenes/Intro";
import { ProblemSolution } from "./scenes/ProblemSolution";
import { Deploy } from "./scenes/Deploy";
import { Tunnels } from "./scenes/Tunnels";
import { Databases } from "./scenes/Databases";
import { BYOC } from "./scenes/BYOC";
import { Dashboard } from "./scenes/Dashboard";
import { Pricing } from "./scenes/Pricing";
import { CLI } from "./scenes/CLI";
import { Outro } from "./scenes/Outro";

const totalFrames = SCENES.outro.start * FPS + SCENES.outro.duration * FPS;

const DeployzyLaunch: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#09090b" }}>
      <Sequence from={SCENES.intro.start * FPS} durationInFrames={SCENES.intro.duration * FPS}>
        <Intro startFrame={SCENES.intro.start * FPS} sceneFrames={SCENES.intro.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.problem.start * FPS} durationInFrames={SCENES.problem.duration * FPS}>
        <ProblemSolution startFrame={SCENES.problem.start * FPS} sceneFrames={SCENES.problem.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.deploy.start * FPS} durationInFrames={SCENES.deploy.duration * FPS}>
        <Deploy startFrame={SCENES.deploy.start * FPS} sceneFrames={SCENES.deploy.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.tunnels.start * FPS} durationInFrames={SCENES.tunnels.duration * FPS}>
        <Tunnels startFrame={SCENES.tunnels.start * FPS} sceneFrames={SCENES.tunnels.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.databases.start * FPS} durationInFrames={SCENES.databases.duration * FPS}>
        <Databases startFrame={SCENES.databases.start * FPS} sceneFrames={SCENES.databases.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.byoc.start * FPS} durationInFrames={SCENES.byoc.duration * FPS}>
        <BYOC startFrame={SCENES.byoc.start * FPS} sceneFrames={SCENES.byoc.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.dashboard.start * FPS} durationInFrames={SCENES.dashboard.duration * FPS}>
        <Dashboard startFrame={SCENES.dashboard.start * FPS} sceneFrames={SCENES.dashboard.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.pricing.start * FPS} durationInFrames={SCENES.pricing.duration * FPS}>
        <Pricing startFrame={SCENES.pricing.start * FPS} sceneFrames={SCENES.pricing.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.cli.start * FPS} durationInFrames={SCENES.cli.duration * FPS}>
        <CLI startFrame={SCENES.cli.start * FPS} sceneFrames={SCENES.cli.duration * FPS} />
      </Sequence>
      <Sequence from={SCENES.outro.start * FPS} durationInFrames={SCENES.outro.duration * FPS}>
        <Outro startFrame={SCENES.outro.start * FPS} sceneFrames={SCENES.outro.duration * FPS} />
      </Sequence>
    </AbsoluteFill>
  );
};

const DeployzyLaunchSquare: React.FC = () => {
  return <DeployzyLaunch />;
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DeployzyLaunch"
        component={DeployzyLaunch}
        durationInFrames={totalFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="DeployzyLaunchSquare"
        component={DeployzyLaunchSquare}
        durationInFrames={totalFrames}
        fps={FPS}
        width={1080}
        height={1080}
      />
    </>
  );
};

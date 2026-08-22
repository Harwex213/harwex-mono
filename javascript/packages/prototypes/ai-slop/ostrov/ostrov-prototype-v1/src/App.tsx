import { ArmyPanel } from "./ui/ArmyPanel";
import { BuildPanel } from "./ui/BuildPanel";
import { GameCanvas } from "./ui/GameCanvas";
import { LogFeed, Toast } from "./ui/LogFeed";
import { Overlay } from "./ui/Overlay";
import { SectorPanel } from "./ui/SectorPanel";
import { SkillBar } from "./ui/SkillBar";
import { TopBar } from "./ui/TopBar";

function App(): React.JSX.Element {
  return (
    <div className="app">
      <GameCanvas />
      <div className="hud">
        <TopBar />
        <div className="columns">
          <div className="column left">
            <BuildPanel />
            <ArmyPanel />
          </div>
          <div className="column right">
            <SectorPanel />
            <LogFeed />
          </div>
        </div>
        <SkillBar />
      </div>
      <Toast />
      <Overlay />
    </div>
  );
}

export { App };
